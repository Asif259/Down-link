# Hostinger All-in-One Media Downloader Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-ready NestJS backend tailored for Hostinger non-VPS hosting to extract, merge, and stream media from YouTube, Facebook, Instagram, and TikTok under strict process, disk, and timeout constraints.

**Architecture:** NestJS on Node.js 20/22+ with zero-system-dependency binaries (`bin/yt-dlp` auto-bootstrapped and `ffmpeg-static`). Employs an in-memory semaphore to guard Hostinger `NPROC` limits, Server-Sent Events (`@Sse()`) for live progress, and a dual delivery pipeline: an SSRF-safe in-memory stream token proxy for progressive CDN links and disk-cleaned FFmpeg muxing for 1080p+ and MP3s.

**Tech Stack:** NestJS 10, TypeScript 5, RxJS 7, class-validator, ffmpeg-static, yt-dlp binary, Jest.

**Spec:** [docs/superpowers/specs/2026-11-14-hostinger-media-downloader-backend.md](file:///Users/ashrafulasif/My%20projects/Down-link/docs/superpowers/specs/2026-11-14-hostinger-media-downloader-backend.md)

## Global Constraints

- Must run on Hostinger Web Hosting without root/sudo, system FFmpeg, Python, or Redis.
- Concurrency capped at 3 simultaneous tasks to prevent 503 `NPROC` errors.
- No direct WebSockets; all streaming progress must use HTTP Server-Sent Events (`@Sse()`).
- Progressive streams must proxy directly from upstream CDNs with preserved extraction headers; no raw client URLs accepted (SSRF protection).
- Temp files generated during FFmpeg muxing must be cleaned up immediately on stream finish or disconnect.
- Standalone `yt-dlp` binary must support local macOS development (`yt-dlp_macos`) and Hostinger Linux (`yt-dlp_linux`).
- Single entrypoint `dist/main.js` binding to dynamic `process.env.PORT || 3000`.

## Review Focus

- **SSRF / Flag Injection:** User cannot pass malicious URLs or CLI flags into `yt-dlp` or proxy internal network resources.
- **Header Forwarding:** Proxy forwards upstream `http_headers` (User-Agent, Referer) so TikTok and Instagram do not return 403.
- **Resource Exhaustion (`NPROC`):** Concurrent jobs exceeding threshold are queued rather than spawning OS processes.
- **Orphan Temp Files:** Aborted or completed downloads delete intermediate `.mp4`/`.mp3` files in `temp/`.
- **Memory Leaks:** Expired stream tokens in `MediaService.streamCache` are routinely evicted via unref'd interval timer.

---

### Task 1: Backend Scaffolding & Configuration

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/tsconfig.build.json`
- Create: `backend/nest-cli.json`
- Create: `backend/.gitignore`

**Interfaces:**
- Produces: Base NestJS package setup, TypeScript compilation config, and dependencies (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `class-validator`, `class-transformer`, `rxjs`, `ffmpeg-static`, `@types/node`, `typescript`, `jest`).

- [ ] **Step 1: Write backend configuration files**
  Create `backend/package.json` with scripts `"build": "nest build"`, `"start": "node dist/main.js"`, `"start:prod": "node dist/main.js"`, `"test": "jest"`. Create `backend/tsconfig.json`, `backend/tsconfig.build.json`, `backend/nest-cli.json`, and `backend/.gitignore`.

- [ ] **Step 2: Install dependencies**
  Run: `cd backend && npm install`
  Expected: Clean install of node_modules and creation of package-lock.json.

- [ ] **Step 3: Verify build tooling**
  Run: `cd backend && npx nest --version`
  Expected: Displays Nest CLI version (e.g. 10.x).

- [ ] **Step 4: Commit**
  ```bash
  git add backend/
  git commit -m "chore: scaffold backend nestjs configuration"
  ```

---

### Task 2: Platform Detection & Strict Input DTOs

**Files:**
- Create: `backend/src/common/platform.util.ts`
- Create: `backend/src/media/dto/media.dto.ts`
- Test: `backend/test/common/platform.util.spec.ts`
- Test: `backend/test/media/media.dto.spec.ts`

**Interfaces:**
- Produces:
  - `detectPlatform(rawUrl: string): SupportedPlatform` where `SupportedPlatform = 'youtube' | 'facebook' | 'instagram' | 'tiktok' | 'unknown'`
  - `ExtractMediaDto` validating `url`
  - `DownloadQueryDto` validating `url`, `formatId`, `type` ('video' | 'audio'), optional `jobId`

- [ ] **Step 1: Write tests for platform detection and DTO validation**
  Test YouTube (`youtube.com`, `youtu.be`), Facebook (`facebook.com`, `fb.watch`), Instagram (`instagram.com`), TikTok (`tiktok.com`), and invalid URLs. Test `DownloadQueryDto` against flag injection characters like `;` or `--`.

- [ ] **Step 2: Run tests to verify they fail**
  Run: `cd backend && npm test -- test/common/platform.util.spec.ts`
  Expected: FAIL with module not found.

- [ ] **Step 3: Implement `detectPlatform` and DTOs**
  Create `backend/src/common/platform.util.ts` and `backend/src/media/dto/media.dto.ts`.

- [ ] **Step 4: Run tests to verify they pass**
  Run: `cd backend && npm test -- test/common/platform.util.spec.ts test/media/media.dto.spec.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add backend/src/common/platform.util.ts backend/src/media/dto/media.dto.ts backend/test/
  git commit -m "feat(common): implement platform detection and input validation DTOs"
  ```

---

### Task 3: Process Concurrency Limiter (Semaphore)

**Files:**
- Create: `backend/src/common/concurrency.service.ts`
- Test: `backend/test/common/concurrency.service.spec.ts`

**Interfaces:**
- Produces: `ConcurrencyService.run<T>(task: () => Promise<T>): Promise<T>` with a default concurrency cap of 3.

- [ ] **Step 1: Write unit test for ConcurrencyService**
  Assert that when 5 asynchronous tasks are submitted concurrently, at most 3 execute simultaneously, and remaining tasks wait until an active task completes.

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd backend && npm test -- test/common/concurrency.service.spec.ts`
  Expected: FAIL with module not found.

- [ ] **Step 3: Implement `ConcurrencyService`**
  Implement in `backend/src/common/concurrency.service.ts`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `cd backend && npm test -- test/common/concurrency.service.spec.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add backend/src/common/concurrency.service.ts backend/test/common/concurrency.service.spec.ts
  git commit -m "feat(common): implement concurrency limiter semaphore"
  ```

---

### Task 4: Binary Bootstrapper Service

**Files:**
- Create: `backend/src/binary/binary.service.ts`
- Create: `backend/src/binary/binary.module.ts`
- Test: `backend/test/binary/binary.service.spec.ts`

**Interfaces:**
- Produces:
  - `BinaryService.ytDlpPath: string`
  - `BinaryService.ffmpegBinaryPath: string`
  - `BinaryService.onModuleInit(): Promise<void>` (ensures `bin/` exists, downloads binary if absent, sets `0o755`)

- [ ] **Step 1: Write unit test for BinaryService**
  Test platform binary resolution (`yt-dlp_macos` on darwin, `yt-dlp.exe` on win32, `yt-dlp_linux` on linux). Test ffmpeg path resolution from `ffmpeg-static`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd backend && npm test -- test/binary/binary.service.spec.ts`
  Expected: FAIL with module not found.

- [ ] **Step 3: Implement `BinaryService` and `BinaryModule`**
  Support `darwin`, `linux`, `win32` platform detection. Handle download with redirect following and `0o755` permissions.

- [ ] **Step 4: Run test to verify it passes**
  Run: `cd backend && npm test -- test/binary/binary.service.spec.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add backend/src/binary/ backend/test/binary/
  git commit -m "feat(binary): implement binary bootstrapper and resolution service"
  ```

---

### Task 5: Stream Proxy Service (SSRF-Safe Progressive Streaming)

**Files:**
- Create: `backend/src/media/stream-proxy.service.ts`
- Test: `backend/test/media/stream-proxy.service.spec.ts`

**Interfaces:**
- Produces:
  - `StreamProxyOptions { targetUrl: string; headers: Record<string, string>; filename: string; mimeType: string }`
  - `StreamProxyService.pipeFromCdn(options: StreamProxyOptions, req: Request, res: Response): void`

- [ ] **Step 1: Write unit tests for StreamProxyService**
  Mock upstream HTTP/HTTPS server. Verify:
  - Custom extraction headers (e.g., `User-Agent`, `Referer`) and `Range` header are forwarded.
  - Upstream 302 redirects are followed up to max limit.
  - Partial content 206 status and Range headers are passed through.
  - Upstream socket is destroyed if client disconnects (`res.on('close')`).

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd backend && npm test -- test/media/stream-proxy.service.spec.ts`
  Expected: FAIL with module not found.

- [ ] **Step 3: Implement `StreamProxyService`**
  Implement zero-dependency `http`/`https` proxy in `backend/src/media/stream-proxy.service.ts`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `cd backend && npm test -- test/media/stream-proxy.service.spec.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add backend/src/media/stream-proxy.service.ts backend/test/media/stream-proxy.service.spec.ts
  git commit -m "feat(media): implement SSRF-safe upstream CDN stream proxy service"
  ```

---

### Task 6: Media Service, Controller, SSE, & Token Cache

**Files:**
- Create: `backend/src/media/media.service.ts`
- Create: `backend/src/media/media.controller.ts`
- Create: `backend/src/media/media.module.ts`
- Create: `backend/src/app.module.ts`
- Create: `backend/src/main.ts`
- Test: `backend/test/media/media.service.spec.ts`
- Test: `backend/test/media/media.controller.spec.ts`

**Interfaces:**
- Produces:
  - `POST /api/media/extract`: Returns `MediaInfoResponse` with `streamToken` on progressive formats (`needsMerge: false`).
  - `GET /api/media/stream/:token`: Streams direct CDN via `StreamProxyService`.
  - `Sse /api/media/progress/:jobId`: Live SSE progress stream.
  - `GET /api/media/download`: Merged download stream with immediate temp file deletion on finish/close.
  - `main.ts`: Boots NestJS app on `process.env.PORT || 3000` with CORS and ValidationPipe.

- [ ] **Step 1: Write tests for MediaService and Controller**
  Test format normalization logic (progressive vs DASH merge vs MP3 audio), token generation and TTL lookup, and controller route dispatching.

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd backend && npm test -- test/media/media.service.spec.ts`
  Expected: FAIL with module not found.

- [ ] **Step 3: Implement MediaService, MediaController, AppModule, and Main**
  Write complete implementations in `backend/src/media/`, `backend/src/app.module.ts`, and `backend/src/main.ts`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `cd backend && npm test -- test/media/media.service.spec.ts test/media/media.controller.spec.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add backend/src/ backend/test/
  git commit -m "feat(media): implement media service, controller, and app bootstrap"
  ```

---

### Task 7: Build Verification & Deployment Documentation

**Files:**
- Create: `backend/README.md`
- Verify: Full compilation with `npm run build`

- [ ] **Step 1: Run production build**
  Run: `cd backend && npm run build`
  Expected: `dist/main.js` and compiled modules generated without TypeScript errors.

- [ ] **Step 2: Write deployment and testing instructions**
  Document Hostinger Web App configuration (Node version, entrypoint `dist/main.js`, env vars), local testing steps, and API route contract in `backend/README.md`.

- [ ] **Step 3: Final commit**
  ```bash
  git add backend/
  git commit -m "docs: add deployment guide and verify production build"
  ```
