# Down-link: All-in-One Media Downloader

Down-link is a full-stack media extraction and downloading platform for **YouTube, Facebook, Instagram, and TikTok**. Users can paste any supported link to automatically detect the source platform, inspect available video and audio formats, and download either progressive streams directly or high-definition merged MP4 and MP3 files with real-time progress tracking.

The system is engineered specifically to run within the constraints of **Hostinger Business Web and Cloud (non-VPS) hosting**, operating without root `sudo` access, system-level Python or FFmpeg installations, Redis, or inbound WebSockets.

---

## Core Architecture & Engineering Highlights

1. **Zero-Process Static Frontend (`output: 'export'`)**
   Compiled with Next.js App Router into static HTML, CSS, and JS served directly by Hostinger's LiteSpeed web server from `public_html`. It consumes zero Node.js processes, reserving your entire account process quota for the backend extraction engine.
2. **Self-Contained Binary Engine (`yt-dlp` + `ffmpeg-static`)**
   On startup, `BinaryService` automatically resolves the host OS (`yt-dlp_linux`, `yt-dlp_macos`, or `yt-dlp.exe`), downloads the standalone executable into `backend/bin/` with `0o755` permissions if missing, and schedules an unreferenced 24-hour background timer (`yt-dlp -U`) to keep extractors up to date. Audio conversion and DASH stream muxing use the bundled `ffmpeg-static` binary inside `node_modules`.
3. **Hybrid Two-Path Delivery Pipeline**
   * **Path A - Zero-Disk Direct Stream Proxy (`/api/media/stream/:token`):** Progressive formats (TikTok unwatermarked videos, Instagram Reels, and 360p/720p MP4s) bypass disk storage and FFmpeg completely. `StreamProxyService` forwards upstream authentication headers (`User-Agent`, `Referer`), enforces SSRF protection against private IP ranges, supports HTTP 206 `Range` byte requests for pause/resume, and aborts the upstream socket immediately if the client disconnects.
   * **Path B - FFmpeg DASH Merge & Audio Extraction (`/api/media/download`):** High-definition 1080p+ DASH video streams and MP3 audio extractions run inside `backend/temp/`, stream live completion percentages over HTTP Server-Sent Events (SSE), and automatically unlink the merged file from disk the moment the response finishes or aborts.
4. **Hostinger `NPROC` Concurrency Semaphore**
   `ConcurrencyService` limits concurrent `yt-dlp` and `FFmpeg` child processes to **3 maximum** with a bounded FIFO queue (capacity: 20), returning `503 Service Unavailable` under extreme saturation instead of crashing the shared hosting container.
5. **Thread-Safe Cookie Authentication**
   Supports Netscape-format cookies via `backend/cookies/` or a base64-encoded `COOKIES_BASE64` environment variable. Each extraction copies the master cookie file to an isolated `temp/cookie_<timestamp>_<rand>.txt` file and deletes it on exit so concurrent processes never corrupt session tokens.
6. **Proxy-Aware Rate Limiting & Automated Disk Sweeper**
   `ProxyThrottlerGuard` extracts the real visitor IP behind Cloudflare (`CF-Connecting-IP`) and LiteSpeed (`X-Forwarded-For`) to enforce per-IP rate limits. `TempCleanupService` purges orphaned media fragments (>15 minutes old) and temporary cookie files (>5 minutes old) on startup and every 10 minutes.

---

## Repository Structure

```text
Down-link/
├── .github/
│   └── workflows/
│       └── deploy.yml                  # CI/CD: Unit + E2E tests, static build, SSH rsync, and smoke test
├── backend/
│   ├── bin/                            # Auto-downloaded standalone yt-dlp binary (gitignored)
│   ├── cookies/                        # Master Netscape cookies.txt store (gitignored)
│   ├── temp/                           # Ephemeral FFmpeg merges & per-process cookie copies
│   ├── src/
│   │   ├── binary/                     # BinaryService: yt-dlp bootstrapper, auto-updater, ffmpeg path
│   │   ├── common/                     # ConcurrencyService, ProxyThrottlerGuard, TempCleanupService
│   │   ├── health/                     # HealthController: disk verification for yt-dlp & ffmpeg
│   │   ├── media/                      # MediaController, MediaService, StreamProxyService, DTOs
│   │   ├── app.module.ts               # Root module & multi-tier Throttler configuration
│   │   └── main.ts                     # NestExpressApplication bootstrap, trust proxy, CORS
│   └── test/                           # Unit tests & Supertest E2E test suite
└── frontend/
    ├── src/
    │   ├── app/                        # Next.js App Router layout, main entry page, global styles
    │   ├── components/                 # MediaDownloader & DownloadHistory interactive UI
    │   └── lib/                        # Client platform detector, formatters, localStorage manager
    └── next.config.ts                  # Configured for static export (output: 'export')
```

---

## API Reference

| Method | Endpoint | Rate Limit | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/media/extract` | 10 / min | Validates URL, detects platform, and returns metadata + format list |
| `GET` | `/api/media/stream/:token` | 15 / min | Zero-disk CDN proxy stream for progressive MP4 formats |
| `GET` | `/api/media/progress/:jobId` | Unthrottled | Server-Sent Events (SSE) stream emitting live `{ status, percent }` |
| `GET` | `/api/media/download` | 4 / min | Runs FFmpeg DASH merge or MP3 conversion, streams file, and unlinks temp file |
| `GET` | `/api/health` | Unthrottled | Verifies `yt-dlp` and `ffmpeg` binaries on disk (`200 OK` or `503`) |

---

## Local Development Setup

### Prerequisites
* **Node.js:** v20 LTS or v22 LTS
* **npm:** v10+
* *(No local Python or FFmpeg installation required)*

### 1. Start the NestJS Backend
```bash
cd backend
npm install
npm run start:dev
```
* On first boot, `BinaryService` automatically downloads the standalone `yt-dlp` binary for your OS into `backend/bin/`.
* The API listens on `http://localhost:3000`.

### 2. Start the Next.js Frontend
Open a second terminal:
```bash
cd frontend
npm install
```
Create `frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```
Run the development server:
```bash
npm run dev
```
* Open `http://localhost:3001` (or `http://localhost:3000` if running on a separate port) in your browser.

---

## Testing & Production Build Verification

The repository includes **54 unit tests across 10 test suites** and **11 Supertest end-to-end (E2E) tests** covering validation pipes, SSRF protection, byte-range streaming, SSE headers, automatic temp file deletion, and per-IP rate limiting.

```bash
# Run Backend Unit Tests (54 tests)
cd backend
npm test

# Run Backend Supertest E2E Suite (11 tests)
npm run test:e2e

# Verify Backend Production Compilation (outputs to backend/dist/)
npm run build

# Verify Frontend Static Export (outputs to frontend/out/)
cd ../frontend
npm run build
```

---

## Hostinger Production Deployment & CI/CD

### 1. Hostinger hPanel Initial Setup
1. **Create the API Subdomain:** In hPanel, go to **Domains -> Subdomains** and create `api.yourdomain.com`.
2. **Enable SSL:** Go to **Security -> SSL** and verify that both `yourdomain.com` and `api.yourdomain.com` are **Active** with **Force HTTPS** enabled.
3. **Create the Node.js Web App:** Go to **Websites -> Node.js** and create an application:
   * **Node.js Version:** `20.x` (or `22.x`)
   * **Application Mode:** `Production`
   * **Application Root:** `/domains/[yourdomain.com/public_html/api](https://yourdomain.com/public_html/api)`
   * **Application Startup File:** `dist/main.js`
   * **Environment Variables:**
     * `ALLOWED_ORIGINS`: `[https://yourdomain.com](https://yourdomain.com),[https://www.yourdomain.com](https://www.yourdomain.com)`
     * `COOKIES_BASE64`: *(Optional)* Base64-encoded Netscape `cookies.txt` string for authenticated Instagram/Facebook/YouTube extraction.

### 2. SSH Key Registration (Port `65002`)
Generate a dedicated CI/CD SSH key pair on your local machine:
```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/hostinger_ci -N ""
```
Copy the public key (`~/.ssh/hostinger_ci.pub`) into **Hostinger hPanel -> Advanced -> SSH Access**.

### 3. GitHub Actions Secrets
Add the following secrets in your GitHub repository under **Settings -> Secrets and variables -> Actions**:

| Secret Name | Example Value | Purpose |
| :--- | :--- | :--- |
| `HOSTINGER_SSH_HOST` | `145.14.156.22` | Hostinger server IP address |
| `HOSTINGER_SSH_PORT` | `65002` | Hostinger SSH port |
| `HOSTINGER_SSH_USER` | `u123456789` | Hostinger system username |
| `HOSTINGER_SSH_PRIVATE_KEY` | `-----BEGIN OPENSSH...` | Private key contents from `~/.ssh/hostinger_ci` |
| `HOSTINGER_FRONTEND_PATH` | `/home/u123456789/domains/[yourdomain.com/public_html](https://yourdomain.com/public_html)` | Target path for static Next.js files |
| `HOSTINGER_BACKEND_PATH` | `/home/u123456789/domains/[yourdomain.com/public_html/api](https://yourdomain.com/public_html/api)` | Target path for NestJS API |
| `NEXT_PUBLIC_API_URL` | `[https://api.yourdomain.com](https://api.yourdomain.com)` | Production API base URL (no trailing slash) |

### 4. Automated Deployment Flow
Every push to `main` triggers `.github/workflows/deploy.yml`:
1. Runs all 54 unit tests and 11 E2E tests.
2. Compiles `backend/dist` and builds `frontend/out` with a production LiteSpeed `.htaccess`.
3. Syncs `frontend/out/` to `public_html` via `rsync` over SSH.
4. Syncs `backend/` to the `api` directory while preserving LiteSpeed's `.htaccess`, `bin/`, and `cookies/`.
5. Executes `npm ci --omit=dev` on the server and touches `tmp/restart.txt` to reload the Passenger Node.js process.
6. Polls `GET /api/health` until both `yt-dlp` and `ffmpeg` report healthy on disk.

---

## Updating Platform Cookies (`COOKIES_BASE64`)

If datacenter IP blocks occur on Instagram, Facebook, or YouTube:
1. Log into a secondary account inside an **Incognito** browser window.
2. Export cookies in Netscape format using the **Get cookies.txt LOCALLY** browser extension.
3. Close the Incognito window directly without clicking "Log Out" (so the session token stays active).
4. Encode the file and paste the output into Hostinger's `COOKIES_BASE64` environment variable:
   ```bash
   base64 -i cookies.txt | pbcopy
   ```