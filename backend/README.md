# Down-link Media Downloader Backend (NestJS)

A high-performance media downloader backend optimized specifically for **Hostinger Web & Cloud hosting** (non-VPS) and local development.

---

## 🚀 Key Architectural Highlights

1. **Hostinger Non-VPS Compatibility**:
   - Zero root `sudo` or system Python/FFmpeg required.
   - Bootstraps standalone `yt-dlp` in `process.cwd()/bin` on module startup (`yt-dlp_linux` in production, `yt-dlp_macos` on macOS, `yt-dlp.exe` on Windows).
   - Bundles `ffmpeg-static` directly inside `node_modules`.
2. **Process Concurrency Guard (`NPROC`)**:
   - An in-memory queue and semaphore (`ConcurrencyService`) caps concurrent child tasks at 3, avoiding `503 Service Unavailable` errors from Hostinger process limits.
3. **SSRF-Safe Progressive Stream Proxy**:
   - Upstream CDN URLs (TikTok, Instagram, and progressive 360p/720p) are cached in-memory with a 20-minute TTL and accessed via single-use/short-lived 32-char hex tokens.
   - Forwards extraction headers (`User-Agent`, `Referer`, `Range`) so CDNs do not return `403 Forbidden`.
   - Never writes to disk or spawns FFmpeg for progressive formats.
4. **SSE Real-Time Progress**:
   - Uses standard HTTP Server-Sent Events (`@Sse('api/media/progress/:jobId')`) via RxJS `Subject`.
   - Bypasses Hostinger's block on inbound WebSockets and Socket.IO.
5. **Auto-Purged Temp Merges**:
   - 1080p+ DASH and MP3 conversion merges files into `temp/` and immediately unlinks the file when the HTTP response completes or closes.

---

## 🛠️ API Reference

### 1. Health & Telemetry
- **Route:** `GET /api/media/health`
- **Response:**
  ```json
  {
    "status": "ok",
    "timestamp": "2026-11-15T03:08:57.941Z",
    "uptimeSeconds": 10,
    "concurrency": {
      "activeCount": 0,
      "queueLength": 0,
      "maxConcurrent": 3,
      "maxQueueLength": 20
    },
    "ytDlpPath": ".../backend/bin/yt-dlp_macos"
  }
  ```

### 2. Extract Media Metadata
- **Route:** `POST /api/media/extract`
- **Request Body:**
  ```json
  {
    "url": "https://www.youtube.com/watch?v=..."
  }
  ```
- **Response:**
  ```json
  {
    "platform": "youtube",
    "title": "Video Title",
    "thumbnail": "https://...",
    "duration": 180,
    "uploader": "Channel Name",
    "formats": [
      {
        "formatId": "18",
        "label": "360p MP4 (Instant Stream)",
        "ext": "mp4",
        "type": "video",
        "resolution": "360p",
        "filesizeApprox": 15420000,
        "needsMerge": false,
        "streamToken": "a1b2c3d4e5f6..."
      },
      {
        "formatId": "137+bestaudio[ext=m4a]/best",
        "label": "1080p HD MP4",
        "ext": "mp4",
        "type": "video",
        "resolution": "1080p",
        "needsMerge": true
      },
      {
        "formatId": "bestaudio",
        "label": "MP3 Audio (High Quality)",
        "ext": "mp3",
        "type": "audio",
        "needsMerge": true
      }
    ]
  }
  ```

### 2. Stream Progressive Format (Zero Disk / Zero FFmpeg)
- **Route:** `GET /api/media/stream/:token`
- Proxies the upstream CDN stream directly with range support and content disposition headers.

### 3. Server-Sent Events (Live Progress)
- **Route:** `GET /api/media/progress/:jobId`
- **Response Headers:** `Content-Type: text/event-stream`
- **Events:**
  ```json
  { "status": "starting", "percent": 5 }
  { "status": "downloading", "percent": 45 }
  { "status": "merging", "percent": 92 }
  { "status": "ready", "percent": 100 }
  ```

### 4. Download Merged Media (DASH 1080p+ & MP3)
- **Route:** `GET /api/media/download?url=...&formatId=...&type=video&jobId=...`
- Merges streams, pipes to client, and deletes temp file automatically on completion or client disconnect.

---

## 📦 Hostinger Web Apps Deployment

1. **Hostinger Node.js Application Setup:**
   - **Node.js Version:** `20.x` or `22.x LTS`
   - **Application Root:** `backend` (or root if deploying only backend)
   - **Application Startup File:** `dist/main.js`
2. **Build Scripts:**
   ```json
   {
     "scripts": {
       "build": "nest build",
       "start": "node dist/main.js",
       "start:prod": "node dist/main.js"
     }
   }
   ```
3. **Environment Variables:**
   - `PORT`: Automatically provided by Hostinger LiteSpeed proxy.
4. **Git Deployment / Deployment Command:**
   ```bash
   npm install && npm run build
   ```

---

## 💻 Local Development

```bash
cd backend
npm install
npm test
npm run start:dev
```
