"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var MediaService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaService = void 0;
const common_1 = require("@nestjs/common");
const child_process_1 = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const rxjs_1 = require("rxjs");
const binary_service_1 = require("../binary/binary.service");
const concurrency_service_1 = require("../common/concurrency.service");
const platform_util_1 = require("../common/platform.util");
let MediaService = MediaService_1 = class MediaService {
    constructor(binaryService, concurrency) {
        this.binaryService = binaryService;
        this.concurrency = concurrency;
        this.logger = new common_1.Logger(MediaService_1.name);
        this.tempDir = path.join(process.cwd(), 'temp');
        this.cookiesDir = path.join(process.cwd(), 'cookies');
        this.jobStreams = new Map();
        this.streamCache = new Map();
        this.cacheTtlMs = 20 * 60 * 1000;
        this.extractTimeoutMs = 35000;
        this.mergeTimeoutMs = 100000;
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
        this.initCookiesDirectory();
        this.cleanupTimer = setInterval(() => {
            this.purgeExpiredTokens();
            this.cleanStaleTempFiles();
        }, 5 * 60 * 1000);
        this.cleanupTimer.unref();
    }
    onModuleInit() {
        this.cleanStaleTempFiles();
    }
    onModuleDestroy() {
        clearInterval(this.cleanupTimer);
    }
    initCookiesDirectory() {
        if (!fs.existsSync(this.cookiesDir)) {
            fs.mkdirSync(this.cookiesDir, { recursive: true });
        }
        if (process.env.COOKIES_BASE64 &&
            process.env.COOKIES_BASE64.trim() &&
            process.env.COOKIES_BASE64 !== 'undefined') {
            try {
                const decoded = Buffer.from(process.env.COOKIES_BASE64, 'base64').toString('utf-8');
                const targetPath = path.join(this.cookiesDir, 'cookies.txt');
                fs.writeFileSync(targetPath, decoded, { mode: 0o600 });
                this.logger.log('Loaded cookies.txt from COOKIES_BASE64 environment variable.');
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                this.logger.warn(`Failed to decode COOKIES_BASE64 environment variable: ${msg}`);
            }
        }
    }
    createTempCookieFile(platform) {
        const platformCookie = path.join(this.cookiesDir, `${platform}.txt`);
        const globalCookie = path.join(this.cookiesDir, 'cookies.txt');
        const sourcePath = fs.existsSync(platformCookie)
            ? platformCookie
            : fs.existsSync(globalCookie)
                ? globalCookie
                : null;
        if (!sourcePath) {
            return null;
        }
        const tempCookiePath = path.join(this.tempDir, `cookie_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.txt`);
        try {
            fs.copyFileSync(sourcePath, tempCookiePath);
            return tempCookiePath;
        }
        catch {
            return null;
        }
    }
    removeTempCookieFile(tempCookiePath) {
        if (tempCookiePath && fs.existsSync(tempCookiePath)) {
            try {
                fs.unlinkSync(tempCookiePath);
            }
            catch { }
        }
    }
    async updateMasterCookies(secret, rawOrBase64Data) {
        const expectedSecret = process.env.ADMIN_COOKIE_SECRET;
        if (!expectedSecret || secret !== expectedSecret) {
            throw new common_1.ForbiddenException('Invalid or missing admin cookie secret.');
        }
        let fileContent = rawOrBase64Data.trim();
        if (!fileContent.startsWith('# Netscape') && !fileContent.includes('\t')) {
            try {
                const decoded = Buffer.from(fileContent, 'base64').toString('utf8');
                if (decoded.includes('Netscape') || decoded.includes('\t')) {
                    fileContent = decoded;
                }
            }
            catch {
            }
        }
        const cookiesDir = path.join(process.cwd(), 'cookies');
        if (!fs.existsSync(cookiesDir)) {
            fs.mkdirSync(cookiesDir, { recursive: true });
        }
        const cookiesPath = path.join(cookiesDir, 'cookies.txt');
        fs.writeFileSync(cookiesPath, fileContent, { encoding: 'utf-8', mode: 0o600 });
        this.logger.log(`Master cookies.txt successfully updated (${Buffer.byteLength(fileContent, 'utf8')} bytes).`);
        return {
            success: true,
            message: 'Master cookies.txt successfully updated.',
            bytesWritten: Buffer.byteLength(fileContent, 'utf8'),
        };
    }
    purgeExpiredTokens() {
        const now = Date.now();
        for (const [token, entry] of this.streamCache.entries()) {
            if (entry.expiresAt <= now) {
                this.streamCache.delete(token);
            }
        }
    }
    cleanStaleTempFiles(maxAgeMs = 30 * 60 * 1000) {
        try {
            if (!fs.existsSync(this.tempDir))
                return;
            const now = Date.now();
            const files = fs.readdirSync(this.tempDir);
            for (const file of files) {
                if (file === '.gitkeep')
                    continue;
                const filePath = path.join(this.tempDir, file);
                try {
                    const stats = fs.statSync(filePath);
                    if (now - stats.mtimeMs >= maxAgeMs) {
                        fs.unlinkSync(filePath);
                        this.logger.debug(`Purged stale temp file: ${file}`);
                    }
                }
                catch { }
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Stale temp cleanup error: ${msg}`);
        }
    }
    getStreamOptions(token) {
        const entry = this.streamCache.get(token);
        if (!entry || entry.expiresAt <= Date.now()) {
            this.streamCache.delete(token);
            throw new common_1.NotFoundException('Download link has expired. Please paste the URL again to refresh.');
        }
        return entry;
    }
    getJobStream(jobId) {
        if (!this.jobStreams.has(jobId)) {
            this.jobStreams.set(jobId, new rxjs_1.Subject());
        }
        return this.jobStreams.get(jobId).asObservable();
    }
    emitProgress(jobId, payload) {
        if (!jobId)
            return;
        const subject = this.jobStreams.get(jobId);
        if (subject) {
            subject.next(payload);
            if (payload.status === 'ready' || payload.status === 'error') {
                subject.complete();
                this.jobStreams.delete(jobId);
            }
        }
    }
    sanitizeFilename(rawTitle, ext) {
        const cleaned = (rawTitle || 'video')
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80);
        return `${cleaned || 'media'}.${ext}`;
    }
    formatYtDlpError(stderr) {
        const lower = stderr.toLowerCase();
        if (lower.includes('sign in to confirm') || lower.includes('not a bot')) {
            return 'YouTube blocked the server IP. Please configure COOKIES_BASE64 in Hostinger environment variables.';
        }
        if (lower.includes('login required') || lower.includes('rate-limit reached')) {
            return 'This platform requires authentication. Please configure COOKIES_BASE64 in Hostinger environment variables.';
        }
        if (lower.includes('failed to map segment') || lower.includes('permission denied')) {
            return 'Server binary execution restricted (TMPDIR noexec).';
        }
        const lastLine = stderr
            .trim()
            .split('\n')
            .reverse()
            .find((line) => line.includes('ERROR:'));
        if (lastLine) {
            return lastLine.replace(/^.*ERROR:\s*(\[[^\]]+\]\s*[^:]+:\s*)?/i, '').slice(0, 180);
        }
        return 'Could not fetch media details. The post may be private or removed.';
    }
    getYoutubeExtractorArgs(hasCookies) {
        if (hasCookies) {
            return [
                '--extractor-args',
                'youtube:player_client=web,mweb,tv',
            ];
        }
        return [
            '--extractor-args',
            'youtube:player_client=android_vr,tv,ios;player_skip=webpage,configs',
        ];
    }
    async extractMetadata(url) {
        const platform = (0, platform_util_1.detectPlatform)(url);
        if (platform === 'unknown') {
            throw new common_1.BadRequestException('Unsupported link. Please provide a YouTube, Facebook, Instagram, or TikTok URL.');
        }
        return this.concurrency.run(() => new Promise((resolve, reject) => {
            const tempCookie = this.createTempCookieFile(platform);
            const cacheDir = path.join(this.tempDir, '.cache');
            const args = [
                '--dump-single-json',
                '--no-playlist',
                '--no-warnings',
                '--cache-dir',
                cacheDir,
                '--no-check-certificates',
                '--geo-bypass',
            ];
            if (platform === 'youtube') {
                args.push(...this.getYoutubeExtractorArgs(Boolean(tempCookie)));
            }
            if (tempCookie) {
                args.push('--cookies', tempCookie);
            }
            args.push(url);
            const child = (0, child_process_1.spawn)(this.binaryService.ytDlpPath, args, {
                shell: false,
                env: this.binaryService.spawnEnv,
            });
            let stdout = '';
            let stderr = '';
            let isDone = false;
            const timer = setTimeout(() => {
                if (isDone)
                    return;
                isDone = true;
                this.removeTempCookieFile(tempCookie);
                try {
                    child.kill('SIGKILL');
                }
                catch { }
                this.logger.warn(`yt-dlp metadata extraction timed out after ${this.extractTimeoutMs}ms for ${url}`);
                reject(new common_1.GatewayTimeoutException('Media analysis timed out. The platform may be throttling requests.'));
            }, this.extractTimeoutMs);
            child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
            child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
            child.on('close', (code) => {
                if (isDone)
                    return;
                isDone = true;
                clearTimeout(timer);
                this.removeTempCookieFile(tempCookie);
                if (code !== 0) {
                    this.logger.warn(`yt-dlp metadata failed: ${stderr.trim().slice(0, 300)}`);
                    return reject(new common_1.BadRequestException(this.formatYtDlpError(stderr)));
                }
                try {
                    const raw = JSON.parse(stdout);
                    const title = raw.title || 'Untitled Media';
                    resolve({
                        platform,
                        title,
                        thumbnail: raw.thumbnail || '',
                        duration: raw.duration || 0,
                        uploader: raw.uploader || raw.channel || 'Unknown',
                        formats: this.normalizeFormats(raw.formats || [], raw.http_headers || {}, title, platform),
                    });
                }
                catch {
                    reject(new common_1.BadRequestException('Failed to parse media metadata from upstream source.'));
                }
            });
            child.on('error', (err) => {
                if (isDone)
                    return;
                isDone = true;
                clearTimeout(timer);
                this.removeTempCookieFile(tempCookie);
                this.logger.error(`Spawn error for yt-dlp: ${err.message}`);
                reject(new common_1.BadRequestException('Failed to launch extractor process.'));
            });
        }));
    }
    normalizeFormats(rawFormats, globalHeaders, title, platform) {
        const clean = [];
        const seenHeights = new Set();
        for (const f of rawFormats) {
            if (f.vcodec !== 'none' && f.acodec !== 'none' && f.height && f.url) {
                if (!seenHeights.has(f.height)) {
                    seenHeights.add(f.height);
                    const token = crypto.randomBytes(16).toString('hex');
                    this.streamCache.set(token, {
                        targetUrl: f.url,
                        headers: { ...globalHeaders, ...(f.http_headers || {}) },
                        filename: this.sanitizeFilename(title, 'mp4'),
                        mimeType: 'video/mp4',
                        expiresAt: Date.now() + this.cacheTtlMs,
                    });
                    clean.push({
                        formatId: String(f.format_id),
                        label: `${f.height}p MP4 (Instant Stream)`,
                        ext: 'mp4',
                        type: 'video',
                        resolution: `${f.height}p`,
                        filesizeApprox: f.filesize || f.filesize_approx,
                        needsMerge: false,
                        streamToken: token,
                    });
                }
            }
        }
        if (platform === 'youtube' || platform === 'facebook') {
            for (const targetHeight of [1080, 720, 480]) {
                if (!seenHeights.has(targetHeight)) {
                    const match = rawFormats.find((f) => f.vcodec !== 'none' && f.acodec === 'none' && f.height === targetHeight);
                    if (match) {
                        seenHeights.add(targetHeight);
                        clean.push({
                            formatId: `${match.format_id}+bestaudio[ext=m4a]/best`,
                            label: `${targetHeight}p HD MP4`,
                            ext: 'mp4',
                            type: 'video',
                            resolution: `${targetHeight}p`,
                            filesizeApprox: match.filesize || match.filesize_approx,
                            needsMerge: true,
                        });
                    }
                }
            }
        }
        clean.push({
            formatId: 'bestaudio',
            label: 'MP3 Audio (High Quality)',
            ext: 'mp3',
            type: 'audio',
            needsMerge: true,
        });
        return clean.sort((a, b) => {
            if (a.type !== b.type)
                return a.type === 'video' ? -1 : 1;
            return parseInt(b.resolution || '0', 10) - parseInt(a.resolution || '0', 10);
        });
    }
    async prepareMergedFile(url, formatId, type, jobId, abortSignal) {
        const platform = (0, platform_util_1.detectPlatform)(url);
        const uniqueId = jobId || `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const ext = type === 'audio' ? 'mp3' : 'mp4';
        const outputTemplate = path.join(this.tempDir, `${uniqueId}.%(ext)s`);
        const finalPath = path.join(this.tempDir, `${uniqueId}.${ext}`);
        const cleanupTempArtifacts = () => {
            try {
                if (fs.existsSync(this.tempDir)) {
                    const files = fs.readdirSync(this.tempDir);
                    for (const file of files) {
                        if (file.startsWith(uniqueId)) {
                            fs.unlinkSync(path.join(this.tempDir, file));
                        }
                    }
                }
            }
            catch { }
        };
        this.emitProgress(jobId, { status: 'starting', percent: 5 });
        await this.concurrency.run(() => new Promise((resolve, reject) => {
            const tempCookie = this.createTempCookieFile(platform);
            const cacheDir = path.join(this.tempDir, '.cache');
            const args = [
                '--no-playlist',
                '--newline',
                '--ffmpeg-location',
                this.binaryService.ffmpegBinaryPath,
                '--cache-dir',
                cacheDir,
                '--no-check-certificates',
                '--geo-bypass',
                '-f',
                formatId,
                '-o',
                outputTemplate,
            ];
            if (platform === 'youtube') {
                args.push(...this.getYoutubeExtractorArgs(Boolean(tempCookie)));
            }
            if (tempCookie) {
                args.push('--cookies', tempCookie);
            }
            if (type === 'audio') {
                args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
            }
            else {
                args.push('--merge-output-format', 'mp4');
            }
            args.push(url);
            const child = (0, child_process_1.spawn)(this.binaryService.ytDlpPath, args, {
                shell: false,
                env: this.binaryService.spawnEnv,
            });
            let isDone = false;
            const abortHandler = () => {
                if (isDone)
                    return;
                isDone = true;
                this.removeTempCookieFile(tempCookie);
                this.logger.log(`Client aborted download job ${uniqueId}; killing child process`);
                try {
                    child.kill('SIGKILL');
                }
                catch { }
                cleanupTempArtifacts();
                reject(new common_1.BadRequestException('Download cancelled by client.'));
            };
            if (abortSignal) {
                if (abortSignal.aborted) {
                    abortHandler();
                    return;
                }
                abortSignal.addEventListener('abort', abortHandler, { once: true });
            }
            const timer = setTimeout(() => {
                if (isDone)
                    return;
                isDone = true;
                this.removeTempCookieFile(tempCookie);
                try {
                    child.kill('SIGKILL');
                }
                catch { }
                cleanupTempArtifacts();
                this.emitProgress(jobId, {
                    status: 'error',
                    percent: 0,
                    message: 'Processing timed out.',
                });
                reject(new common_1.GatewayTimeoutException('Media processing exceeded maximum allowable time.'));
            }, this.mergeTimeoutMs);
            child.stdout.on('data', (chunk) => {
                const line = chunk.toString();
                const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
                if (match) {
                    const pct = Math.min(85, Math.round(parseFloat(match[1]) * 0.85));
                    this.emitProgress(jobId, { status: 'downloading', percent: pct });
                }
                else if (line.includes('[Merger]') || line.includes('[ExtractAudio]')) {
                    this.emitProgress(jobId, { status: 'merging', percent: 92 });
                }
            });
            child.on('close', (code) => {
                if (isDone)
                    return;
                isDone = true;
                clearTimeout(timer);
                this.removeTempCookieFile(tempCookie);
                if (abortSignal) {
                    abortSignal.removeEventListener('abort', abortHandler);
                }
                if (code !== 0 || !fs.existsSync(finalPath)) {
                    cleanupTempArtifacts();
                    this.emitProgress(jobId, {
                        status: 'error',
                        percent: 0,
                        message: 'Media processing failed.',
                    });
                    return reject(new common_1.BadRequestException('Failed to process requested media format.'));
                }
                this.emitProgress(jobId, { status: 'ready', percent: 100 });
                resolve();
            });
            child.on('error', (err) => {
                if (isDone)
                    return;
                isDone = true;
                clearTimeout(timer);
                this.removeTempCookieFile(tempCookie);
                cleanupTempArtifacts();
                this.logger.error(`Merge process error: ${err.message}`);
                reject(new common_1.BadRequestException('Failed to execute merge process.'));
            });
        }));
        return {
            filePath: finalPath,
            filename: `media_${uniqueId}.${ext}`,
            mimeType: type === 'audio' ? 'audio/mpeg' : 'video/mp4',
        };
    }
};
exports.MediaService = MediaService;
exports.MediaService = MediaService = MediaService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [binary_service_1.BinaryService,
        concurrency_service_1.ConcurrencyService])
], MediaService);
//# sourceMappingURL=media.service.js.map