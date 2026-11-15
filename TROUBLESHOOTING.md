# Down-link: Production Troubleshooting Runbook (Hostinger)

This runbook covers rapid diagnostics and fixes for the most common production issues on Hostinger shared and cloud environments: **`503` `NPROC` process exhaustion**, **expired platform cookies**, **`yt-dlp` extractor breakage**, and **LiteSpeed/Passenger binary issues**.

---

## 1. Quick Diagnostic Matrix

First, connect to your Hostinger container over SSH (port `65002`):

```bash
ssh -p 65002 u123456789@your-server-ip
cd ~/domains/yourdomain.com/public_html/api
```

| Symptom | Likely Cause | Immediate Diagnostic Command |
| :--- | :--- | :--- |
| `503 Service Unavailable` on all routes | `NPROC` limit hit or binary missing | `curl -i [https://api.yourdomain.com/api/health](https://api.yourdomain.com/api/health)` |
| `spawn EAGAIN` in error logs | Too many OS threads from FFmpeg | `ps -eLf \| grep -E "node\|yt-dlp\|ffmpeg" \| wc -l` |
| Instagram/YouTube returns `400 Bad Request` | Expired `cookies.txt` or IP challenge | `./bin/yt-dlp_linux --cookies cookies/cookies.txt -J "URL"` |
| `spawn EACCES` or `Exec format error` | Missing `chmod 755` or macOS binary uploaded | `file ./bin/yt-dlp_linux ./node_modules/ffmpeg-static/ffmpeg` |
| Progress bar stuck at `5%` until completion | LiteSpeed buffering SSE stream | `curl -I [https://api.yourdomain.com/api/media/progress/test](https://api.yourdomain.com/api/media/progress/test)` |

---

## 2. Fixing `503 Service Unavailable` & `NPROC` Process Limits

Hostinger Business and Cloud plans enforce a strict limit on the total number of processes and threads (`NPROC`) your Linux user can run simultaneously. 

### Why It Happens
1. **Unbounded FFmpeg Thread Spawning:** By default, `ffmpeg` detects the host CPU core count and spawns one thread per core. On a 32-core Hostinger server, a single FFmpeg merge can attempt to spawn 32+ threads, instantly hitting your `NPROC` ceiling (`Error: spawn EAGAIN`).
2. **Hung Upstream Processes:** If an upstream CDN stalls and never closes the socket, `yt-dlp` can stay alive in the background, occupying one of the 3 slots in `ConcurrencyService`.
3. **Queue Overflow:** `ConcurrencyService` allows 3 active tasks and 20 queued tasks. The 24th simultaneous request intentionally throws `503` to protect the server.

### Immediate Recovery via SSH
Inspect and kill any hung `yt-dlp` or `ffmpeg` child processes, then restart Passenger:

```bash
# 1. Check active processes and thread counts under your user
ps -u $USER -o pid,nlwp,etime,cmd

# 2. Force-kill stuck media processes older than 2 minutes
pkill -9 -f yt-dlp_linux || true
pkill -9 -f ffmpeg || true

# 3. Clean leftover temp fragments and reload the NestJS app
rm -rf ./temp/*
mkdir -p tmp && touch tmp/restart.txt
```

### Permanent Code Prevention (Cap FFmpeg Threads & Process Timeout)
In `backend/src/media/media.service.ts`, pass `--postprocessor-args "ffmpeg:-threads 2"` into `prepareMergedFile` so FFmpeg never spawns more than 2 threads per job, and enforce a 90-second child process timeout (safely below Hostinger's 120-second HTTP timeout):

```typescript
// Inside prepareMergedFile() args array in media.service.ts:
const args = [
  '--no-playlist',
  '--newline',
  '--socket-timeout',
  '15',
  '--ffmpeg-location',
  this.binaryService.ffmpegBinaryPath,
  '--postprocessor-args',
  'ffmpeg:-threads 2',
  '-f',
  formatId,
  '-o',
  outputTemplate,
];

// Enforce a hard 90s kill timer on the child process
const child = spawn(this.binaryService.ytDlpPath, args, {
  shell: false,
  timeout: 90000,
});
```

---

## 3. Fixing Expired Cookies & Platform Bot Blocks

Datacenter IPs are frequently challenged by Meta and Google. When cookies expire or get invalidated, `/api/media/extract` returns `400 Bad Request` (`Could not fetch media details. The post may be private.`).

### Step 1: Verify If Cookies Are the Cause
Run `yt-dlp` manually over SSH against a failing URL to view the raw platform error:

```bash
./bin/yt-dlp_linux \
  --cookies ./cookies/cookies.txt \
  --no-playlist \
  --dump-single-json \
  "https://www.instagram.com/reel/Cxyz123/" > /dev/null
```

Look at the `stderr` output:
* `Sign in to confirm you're not a bot` (YouTube): Your YouTube session cookie expired or the account requires a captcha check.
* `Login required` or `rate-limit reached` (Instagram/Facebook): Your Instagram `sessionid` cookie expired.

### Step 2: Refresh Cookies Without Invalidating the Session
1. Open a fresh **Incognito / Private** browser window on your computer.
2. Log into a **secondary/throwaway account** on YouTube, Instagram, or Facebook.
3. Use the **Get cookies.txt LOCALLY** browser extension to export the cookies in **Netscape** format.
4. **CRITICAL:** Close the Incognito window directly by clicking the window `X`. **Do NOT click "Log Out"** inside the website, as logging out immediately invalidates the server-side session token you just exported.

### Step 3: Deploy the New Cookies to Hostinger

**Option A - Via `COOKIES_BASE64` Environment Variable (Recommended):**
Encode the file on your Mac:
```bash
base64 -i cookies.txt | pbcopy
```
Paste the string into **Hostinger hPanel -> Websites -> Node.js -> Environment Variables -> `COOKIES_BASE64`**, save, and click **Restart**.

**Option B - Direct Upload via SSH (Zero-Downtime):**
```bash
scp -P 65002 cookies.txt u123456789@your-server-ip:~/domains/yourdomain.com/public_html/api/cookies/cookies.txt
```
*(Because `MediaService` checks `cookies/cookies.txt` on every extraction, direct file replacement takes effect immediately without restarting Node.js.)*

---

## 4. Fixing `yt-dlp` Extractor Breakage & Update Errors

Social platforms (especially YouTube and TikTok) frequently rotate player signatures. When that happens, extractions fail until `yt-dlp` is updated.

### Scenario A: YouTube Breaks Before a Stable `yt-dlp` Release
If `./bin/yt-dlp_linux -U` says `yt-dlp is up to date` on the stable channel, switch the binary to the **nightly** channel where platform fixes land within hours:

```bash
cd ~/domains/yourdomain.com/public_html/api
./bin/yt-dlp_linux --update-to nightly
```

### Scenario B: `ETXTBSY` (Text File Busy) or Corrupted Binary (`< 1MB`)
On Linux, overwriting an executable file directly while a child process is running it causes an `ETXTBSY` kernel error. Or, if GitHub throttled a download during boot, `./bin/yt-dlp_linux` may be an incomplete file, causing `/api/health` to fail or extractions to hang.

Perform an **atomic binary replacement** over SSH (Linux `mv` swaps the directory pointer cleanly even if a process is currently running the old file):

```bash
cd ~/domains/yourdomain.com/public_html/api/bin

# 1. Download to a temporary filename
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o yt-dlp_linux.new

# 2. Verify the downloaded binary is valid (> 2MB) and mark executable
ls -lh yt-dlp_linux.new
chmod 755 yt-dlp_linux.new

# 3. Verify version output
./yt-dlp_linux.new --version

# 4. Atomically swap into place
mv -f yt-dlp_linux.new yt-dlp_linux
```

---

## 5. Fixing `Exec format error` & Disk/Inode Exhaustion

### `Error: spawn ... Exec format error`
This error occurs if macOS (`Darwin arm64`) binaries from your local `node_modules/ffmpeg-static` or `bin/` folder were accidentally uploaded to Hostinger's Linux (`x86_64`) server.

**Fix via SSH:**
```bash
cd ~/domains/yourdomain.com/public_html/api

# 1. Remove local macOS artifacts
rm -rf node_modules ./bin/yt-dlp*

# 2. Reinstall native Linux x64 packages and trigger BinaryService bootstrap
export PATH=$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin:/opt/alt/alt-nodejs20/root/usr/bin:$PATH
npm ci --omit=dev --no-audit --no-fund
touch tmp/restart.txt

# 3. Trigger lazy-boot and verify health
curl -i https://api.yourdomain.com/api/health
```

### `ENOSPC: no space left on device` (Disk or Inode Limit)
Hostinger plans cap both total disk storage (GB) and total file count (inodes). Check both metrics over SSH:

```bash
# Check disk space usage
df -h

# Check inode (file count) usage
df -i

# Purge orphaned temp files and npm cache
rm -rf ~/domains/yourdomain.com/public_html/api/temp/*
npm cache clean --force
```