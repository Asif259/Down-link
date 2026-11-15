import {
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Observable, Subject } from 'rxjs';
import { BinaryService } from '../binary/binary.service';
import { ConcurrencyService } from '../common/concurrency.service';
import { detectPlatform, SupportedPlatform } from '../common/platform.util';
import { StreamProxyOptions } from './stream-proxy.service';

export interface CleanFormat {
  formatId: string;
  label: string;
  ext: string;
  type: 'video' | 'audio';
  resolution?: string;
  filesizeApprox?: number;
  needsMerge: boolean;
  streamToken?: string;
}

export interface MediaInfoResponse {
  platform: SupportedPlatform;
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  formats: CleanFormat[];
}

export interface JobProgress {
  status: 'starting' | 'downloading' | 'merging' | 'ready' | 'error';
  percent: number;
  message?: string;
}

interface CachedStreamEntry extends StreamProxyOptions {
  expiresAt: number;
}

@Injectable()
export class MediaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaService.name);
  private readonly tempDir = path.join(process.cwd(), 'temp');
  private readonly cookiesDir = path.join(process.cwd(), 'cookies');
  private readonly jobStreams = new Map<string, Subject<JobProgress>>();
  private readonly streamCache = new Map<string, CachedStreamEntry>();
  private readonly cacheTtlMs = 20 * 60 * 1000; // 20 minutes
  private readonly cleanupTimer: NodeJS.Timeout;
  private readonly extractTimeoutMs = 35000; // 35s max for metadata extraction
  private readonly mergeTimeoutMs = 100000; // 100s max (strictly under Hostinger 120s ceiling)

  constructor(
    private readonly binaryService: BinaryService,
    private readonly concurrency: ConcurrencyService,
  ) {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    this.initCookiesDirectory();

    // Periodically purge expired stream tokens and stale temp files
    this.cleanupTimer = setInterval(() => {
      this.purgeExpiredTokens();
      this.cleanStaleTempFiles();
    }, 5 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  onModuleInit(): void {
    this.cleanStaleTempFiles();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  initCookiesDirectory(): void {
    if (!fs.existsSync(this.cookiesDir)) {
      fs.mkdirSync(this.cookiesDir, { recursive: true });
    }

    // Hydrate cookies/cookies.txt from Hostinger environment variable if provided
    if (process.env.COOKIES_BASE64) {
      try {
        const decoded = Buffer.from(process.env.COOKIES_BASE64, 'base64').toString('utf-8');
        const targetPath = path.join(this.cookiesDir, 'cookies.txt');
        fs.writeFileSync(targetPath, decoded, { mode: 0o600 });
        this.logger.log('Loaded cookies.txt from COOKIES_BASE64 environment variable.');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed to decode COOKIES_BASE64 environment variable: ${msg}`);
      }
    }
  }

  /**
   * Creates an isolated temporary copy of the cookie file for a single yt-dlp run
   * so concurrent downloads never corrupt or overwrite your master cookies.txt.
   */
  createTempCookieFile(platform: SupportedPlatform): string | null {
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

    const tempCookiePath = path.join(
      this.tempDir,
      `cookie_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.txt`,
    );
    try {
      fs.copyFileSync(sourcePath, tempCookiePath);
      return tempCookiePath;
    } catch {
      return null;
    }
  }

  removeTempCookieFile(tempCookiePath: string | null): void {
    if (tempCookiePath && fs.existsSync(tempCookiePath)) {
      try {
        fs.unlinkSync(tempCookiePath);
      } catch {}
    }
  }

  private purgeExpiredTokens(): void {
    const now = Date.now();
    for (const [token, entry] of this.streamCache.entries()) {
      if (entry.expiresAt <= now) {
        this.streamCache.delete(token);
      }
    }
  }

  cleanStaleTempFiles(maxAgeMs = 30 * 60 * 1000): void {
    try {
      if (!fs.existsSync(this.tempDir)) return;
      const now = Date.now();
      const files = fs.readdirSync(this.tempDir);
      for (const file of files) {
        if (file === '.gitkeep') continue;
        const filePath = path.join(this.tempDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs >= maxAgeMs) {
            fs.unlinkSync(filePath);
            this.logger.debug(`Purged stale temp file: ${file}`);
          }
        } catch {}
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Stale temp cleanup error: ${msg}`);
    }
  }

  getStreamOptions(token: string): StreamProxyOptions {
    const entry = this.streamCache.get(token);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.streamCache.delete(token);
      throw new NotFoundException(
        'Download link has expired. Please paste the URL again to refresh.',
      );
    }
    return entry;
  }

  getJobStream(jobId: string): Observable<JobProgress> {
    if (!this.jobStreams.has(jobId)) {
      this.jobStreams.set(jobId, new Subject<JobProgress>());
    }
    return this.jobStreams.get(jobId)!.asObservable();
  }

  private emitProgress(jobId: string | undefined, payload: JobProgress): void {
    if (!jobId) return;
    const subject = this.jobStreams.get(jobId);
    if (subject) {
      subject.next(payload);
      if (payload.status === 'ready' || payload.status === 'error') {
        subject.complete();
        this.jobStreams.delete(jobId);
      }
    }
  }

  private sanitizeFilename(rawTitle: string, ext: string): string {
    const cleaned = (rawTitle || 'video')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    return `${cleaned || 'media'}.${ext}`;
  }

  private formatYtDlpError(stderr: string): string {
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

  async extractMetadata(url: string): Promise<MediaInfoResponse> {
    const platform = detectPlatform(url);
    if (platform === 'unknown') {
      throw new BadRequestException(
        'Unsupported link. Please provide a YouTube, Facebook, Instagram, or TikTok URL.',
      );
    }

    return this.concurrency.run(
      () =>
        new Promise((resolve, reject) => {
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
            args.push('--extractor-args', 'youtube:player_client=ios,mweb,web');
          }

          if (tempCookie) {
            args.push('--cookies', tempCookie);
          }
          args.push(url);

          const child = spawn(this.binaryService.ytDlpPath, args, {
            shell: false,
            env: this.binaryService.spawnEnv,
          });
          let stdout = '';
          let stderr = '';
          let isDone = false;

          const timer = setTimeout(() => {
            if (isDone) return;
            isDone = true;
            this.removeTempCookieFile(tempCookie);
            try {
              child.kill('SIGKILL');
            } catch {}
            this.logger.warn(`yt-dlp metadata extraction timed out after ${this.extractTimeoutMs}ms for ${url}`);
            reject(
              new GatewayTimeoutException('Media analysis timed out. The platform may be throttling requests.'),
            );
          }, this.extractTimeoutMs);

          child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
          child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

          child.on('close', (code) => {
            if (isDone) return;
            isDone = true;
            clearTimeout(timer);
            this.removeTempCookieFile(tempCookie);

            if (code !== 0) {
              this.logger.warn(`yt-dlp metadata failed: ${stderr.trim().slice(0, 300)}`);
              return reject(
                new BadRequestException(this.formatYtDlpError(stderr)),
              );
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
                formats: this.normalizeFormats(
                  raw.formats || [],
                  raw.http_headers || {},
                  title,
                  platform,
                ),
              });
            } catch {
              reject(new BadRequestException('Failed to parse media metadata from upstream source.'));
            }
          });

          child.on('error', (err) => {
            if (isDone) return;
            isDone = true;
            clearTimeout(timer);
            this.removeTempCookieFile(tempCookie);
            this.logger.error(`Spawn error for yt-dlp: ${err.message}`);
            reject(new BadRequestException('Failed to launch extractor process.'));
          });
        }),
    );
  }

  private normalizeFormats(
    rawFormats: any[],
    globalHeaders: Record<string, string>,
    title: string,
    platform: SupportedPlatform,
  ): CleanFormat[] {
    const clean: CleanFormat[] = [];
    const seenHeights = new Set<number>();

    // 1. Progressive formats (both video + audio -> zero disk/FFmpeg overhead)
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

    // 2. High-res DASH video-only streams (requires FFmpeg merge with bestaudio)
    if (platform === 'youtube' || platform === 'facebook') {
      for (const targetHeight of [1080, 720, 480]) {
        if (!seenHeights.has(targetHeight)) {
          const match = rawFormats.find(
            (f) => f.vcodec !== 'none' && f.acodec === 'none' && f.height === targetHeight,
          );
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

    // 3. Universal Audio Extraction Option
    clean.push({
      formatId: 'bestaudio',
      label: 'MP3 Audio (High Quality)',
      ext: 'mp3',
      type: 'audio',
      needsMerge: true,
    });

    return clean.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'video' ? -1 : 1;
      return parseInt(b.resolution || '0', 10) - parseInt(a.resolution || '0', 10);
    });
  }

  async prepareMergedFile(
    url: string,
    formatId: string,
    type: 'video' | 'audio',
    jobId?: string,
    abortSignal?: AbortSignal,
  ): Promise<{ filePath: string; filename: string; mimeType: string }> {
    const platform = detectPlatform(url);
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
      } catch {}
    };

    this.emitProgress(jobId, { status: 'starting', percent: 5 });

    await this.concurrency.run(
      () =>
        new Promise<void>((resolve, reject) => {
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
            args.push('--extractor-args', 'youtube:player_client=ios,mweb,web');
          }

          if (tempCookie) {
            args.push('--cookies', tempCookie);
          }

          if (type === 'audio') {
            args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
          } else {
            args.push('--merge-output-format', 'mp4');
          }

          args.push(url);

          const child = spawn(this.binaryService.ytDlpPath, args, {
            shell: false,
            env: this.binaryService.spawnEnv,
          });
          let isDone = false;

          const abortHandler = () => {
            if (isDone) return;
            isDone = true;
            this.removeTempCookieFile(tempCookie);
            this.logger.log(`Client aborted download job ${uniqueId}; killing child process`);
            try {
              child.kill('SIGKILL');
            } catch {}
            cleanupTempArtifacts();
            reject(new BadRequestException('Download cancelled by client.'));
          };

          if (abortSignal) {
            if (abortSignal.aborted) {
              abortHandler();
              return;
            }
            abortSignal.addEventListener('abort', abortHandler, { once: true });
          }

          const timer = setTimeout(() => {
            if (isDone) return;
            isDone = true;
            this.removeTempCookieFile(tempCookie);
            try {
              child.kill('SIGKILL');
            } catch {}
            cleanupTempArtifacts();
            this.emitProgress(jobId, {
              status: 'error',
              percent: 0,
              message: 'Processing timed out.',
            });
            reject(
              new GatewayTimeoutException('Media processing exceeded maximum allowable time.'),
            );
          }, this.mergeTimeoutMs);

          child.stdout.on('data', (chunk) => {
            const line = chunk.toString();
            const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
            if (match) {
              const pct = Math.min(85, Math.round(parseFloat(match[1]) * 0.85));
              this.emitProgress(jobId, { status: 'downloading', percent: pct });
            } else if (line.includes('[Merger]') || line.includes('[ExtractAudio]')) {
              this.emitProgress(jobId, { status: 'merging', percent: 92 });
            }
          });

          child.on('close', (code) => {
            if (isDone) return;
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
              return reject(new BadRequestException('Failed to process requested media format.'));
            }
            this.emitProgress(jobId, { status: 'ready', percent: 100 });
            resolve();
          });

          child.on('error', (err) => {
            if (isDone) return;
            isDone = true;
            clearTimeout(timer);
            this.removeTempCookieFile(tempCookie);
            cleanupTempArtifacts();
            this.logger.error(`Merge process error: ${err.message}`);
            reject(new BadRequestException('Failed to execute merge process.'));
          });
        }),
    );

    return {
      filePath: finalPath,
      filename: `media_${uniqueId}.${ext}`,
      mimeType: type === 'audio' ? 'audio/mpeg' : 'video/mp4',
    };
  }
}
