# Hostinger Non-VPS All-in-One Media Downloader Backend Spec

## 1. Problem & Context
Hosting an all-in-one media downloader (supporting YouTube, Facebook, Instagram, TikTok) on Hostinger Business Web Hosting / Cloud hosting presents specific platform restrictions:
- No root `sudo` access.
- No system-installed FFmpeg, Python, Redis, or Docker.
- Inbound WebSockets / Socket.IO are blocked or unreliable on shared LiteSpeed proxies.
- Strict 120-second HTTP request timeout.
- Shared process limit (`NPROC`) per account; excessive concurrent child processes cause `503 Service Unavailable`.
- Shared `/tmp` directory is mounted with `noexec` on many shared tiers.

## 2. Architecture & Design Principles
1. **NestJS on Node 20/22+ LTS**: Standard, single-entrypoint (`dist/main.js`) framework with built-in DI, ValidationPipe, and SSE support.
2. **Standalone Binaries in Project Dir**:
   - `bin/yt-dlp_linux` (production on Hostinger) and `bin/yt-dlp_macos` (local macOS development) auto-downloaded on boot with `0o755` permissions. No system Python needed.
   - `ffmpeg-static` npm package provides precompiled static `ffmpeg` executable without system package managers.
3. **In-Memory Concurrency Semaphore**: Caps concurrent extraction and muxing jobs to a safe threshold (e.g., max 3) to strictly stay below Hostinger `NPROC` limits.
4. **Real-Time Progress via SSE (`@Sse()`)**: Standard HTTP `text/event-stream` bypassing WebSocket restrictions, delivering real-time download and merge percentages to the client.
5. **SSRF-Safe Direct CDN Stream Proxy (`StreamProxyService`)**:
   - Upstream CDNs (TikTok, Instagram) block requests lacking specific session headers, `User-Agent`, or `Referer`.
   - Never accept raw client URLs. Progressive formats cache upstream CDN URLs and headers in an in-memory TTL map (`Map<string, CachedStreamEntry>`).
   - Issues short-lived hex tokens (`streamToken`, 32 hex chars, 20-min TTL).
   - `GET /api/media/stream/:token` proxies chunks, preserves byte ranges (`Range` / `206 Partial Content`), follows CDN redirects, sets UTF-8 `Content-Disposition`, and aborts upstream if client disconnects. Zero disk usage, zero FFmpeg.
6. **FFmpeg Merge Route (`GET /api/media/download`)**:
   - For 1080p+ DASH and MP3 conversion, merges audio + video into `./temp/<jobId>.<ext>`.
   - Broadcasts progress via RxJS Subject mapped to `/api/media/progress/:jobId`.
   - Streams file to client and hooks `res.on('finish')` / `res.on('close')` to immediately delete the temp file.
7. **Hostinger Deployment**:
   - `package.json` with `"build": "nest build"`, `"start": "node dist/main.js"`, `"start:prod": "node dist/main.js"`.
   - `src/main.ts` binds dynamically to `process.env.PORT || 3000` with CORS enabled.
