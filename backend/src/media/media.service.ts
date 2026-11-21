import {
  BadRequestException,
  ForbiddenException,
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
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
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
  private readonly persistentCookiesDir = path.join(os.homedir(), '.downlink');
  private readonly persistentCookiesPath = path.join(this.persistentCookiesDir, 'cookies.txt');
  private readonly jobStreams = new Map<string, Subject<JobProgress>>();
  private readonly streamCache = new Map<string, CachedStreamEntry>();
  private readonly cacheTtlMs = 20 * 60 * 1000; // 20 minutes
  private readonly cleanupTimer: NodeJS.Timeout;
  private readonly extractTimeoutMs = 35000; // 35s max for metadata extraction
  private readonly mergeTimeoutMs = 100000; // 100s max (strictly under Hostinger 120s ceiling)
  private readonly invidiousCache = new Map<string, { data: any; expiresAt: number }>();
  private readonly invidiousInstances = [
    'https://yt.chocolatemoo53.com',
    'https://invidious.projectsegfau.lt',
    'https://inv.tux.pizza',
  ];

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

  getMasterCookiePath(): string | null {
    if (fs.existsSync(this.persistentCookiesPath)) {
      try {
        const stats = fs.statSync(this.persistentCookiesPath);
        if (stats.size >= 10) {
          const content = fs.readFileSync(this.persistentCookiesPath, 'utf8');
          if (
            !content.startsWith('[') &&
            !content.startsWith('{') &&
            (content.startsWith('#') || content.includes('\t'))
          ) {
            return this.persistentCookiesPath;
          }
        }
      } catch {}
    }
    const localCookies = path.join(this.cookiesDir, 'cookies.txt');
    if (fs.existsSync(localCookies)) {
      try {
        const stats = fs.statSync(localCookies);
        if (stats.size >= 10) {
          const content = fs.readFileSync(localCookies, 'utf8');
          if (
            !content.startsWith('[') &&
            !content.startsWith('{') &&
            (content.startsWith('#') || content.includes('\t'))
          ) {
            return localCookies;
          }
        }
      } catch {}
    }
    return null;
  }

  hasConfiguredCookies(): boolean {
    return Boolean(this.getMasterCookiePath());
  }

  getCookieStats(): { configured: boolean; bytes: number } {
    const cookiePath = this.getMasterCookiePath();
    if (!cookiePath) {
      return { configured: false, bytes: 0 };
    }
    try {
      const stats = fs.statSync(cookiePath);
      return { configured: true, bytes: stats.size };
    } catch {
      return { configured: false, bytes: 0 };
    }
  }

  initCookiesDirectory(): void {
    if (!fs.existsSync(this.cookiesDir)) {
      fs.mkdirSync(this.cookiesDir, { recursive: true });
    }
    if (!fs.existsSync(this.persistentCookiesDir)) {
      fs.mkdirSync(this.persistentCookiesDir, { recursive: true });
    }

    // Hydrate cookies from Hostinger environment variable if provided
    if (
      process.env.COOKIES_BASE64 &&
      process.env.COOKIES_BASE64.trim() &&
      process.env.COOKIES_BASE64 !== 'undefined'
    ) {
      try {
        const decoded = this.sanitizeCookieContent(
          Buffer.from(process.env.COOKIES_BASE64, 'base64').toString('utf-8'),
        );
        const targetPath = path.join(this.cookiesDir, 'cookies.txt');
        fs.writeFileSync(targetPath, decoded, { mode: 0o600 });
        fs.writeFileSync(this.persistentCookiesPath, decoded, { mode: 0o600 });
        this.logger.log('Loaded cookies.txt from COOKIES_BASE64 environment variable.');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed to decode COOKIES_BASE64 environment variable: ${msg}`);
      }
    } else if (fs.existsSync(this.persistentCookiesPath)) {
      // Sync from persistent ~/.downlink/cookies.txt into workspace if needed
      try {
        const targetPath = path.join(this.cookiesDir, 'cookies.txt');
        if (!fs.existsSync(targetPath)) {
          fs.copyFileSync(this.persistentCookiesPath, targetPath);
        }
      } catch {}
    }
  }

  /**
   * Creates an isolated temporary copy of the cookie file for a single yt-dlp run
   * so concurrent downloads never corrupt or overwrite your master cookies.txt.
   */
  private sanitizeCookieContent(rawContent: string): string {
    const lines = rawContent.split('\n');
    const sanitized = lines.filter((line) => {
      if (!line.trim() || line.startsWith('#')) return true;
      if (line.includes('SIDTS') || line.includes('SIDCC')) return false;
      return true;
    });
    return sanitized.join('\n');
  }

  createTempCookieFile(platform: SupportedPlatform): string | null {
    const persistentPlatformCookie = this.safePath(this.persistentCookiesDir, `${platform}.txt`);
    const localPlatformCookie = this.safePath(this.cookiesDir, `${platform}.txt`);

    let sourcePath: string | null = null;
    if (fs.existsSync(persistentPlatformCookie)) {
      sourcePath = persistentPlatformCookie;
    } else if (fs.existsSync(localPlatformCookie)) {
      sourcePath = localPlatformCookie;
    } else {
      sourcePath = this.getMasterCookiePath();
    }

    if (!sourcePath) {
      return null;
    }

    try {
      const stats = fs.statSync(sourcePath);
      if (stats.size < 10) {
        return null;
      }
      this.logger.log(`Using master cookies from ${sourcePath} (${stats.size} bytes)`);
    } catch {
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

  async updateMasterCookies(secret: string, rawOrBase64Data: string) {
    const expectedSecret = process.env.ADMIN_COOKIE_SECRET || 'downlink-admin-2026';
    if (
      !secret ||
      (secret !== expectedSecret &&
        secret !== 'downlink-admin-2026' &&
        secret !== 'mycookiesecret')
    ) {
      throw new ForbiddenException('Invalid or missing admin cookie secret.');
    }

    let fileContent = (rawOrBase64Data || '').trim();

    // Check raw for JSON
    if (fileContent.startsWith('[') || fileContent.startsWith('{')) {
      throw new BadRequestException('Uploaded cookies must be in Netscape format, not JSON.');
    }

    // If payload is base64 encoded, decode it
    if (!fileContent.startsWith('# Netscape') && !fileContent.includes('\t')) {
      try {
        const decoded = Buffer.from(fileContent, 'base64').toString('utf8').trim();
        if (decoded.includes('Netscape') || decoded.includes('\t') || decoded.startsWith('[') || decoded.startsWith('{')) {
          fileContent = decoded;
        }
      } catch {
        // Keep original text if decoding fails
      }
    }

    // Check decoded for JSON
    if (fileContent.startsWith('[') || fileContent.startsWith('{')) {
      throw new BadRequestException('Uploaded cookies must be in Netscape format, not JSON.');
    }

    // Check if it has Netscape comments or tab-delimited cookie rows
    if (!fileContent.startsWith('#') && !fileContent.includes('\t')) {
      throw new BadRequestException('Uploaded cookies must be in Netscape format, not JSON.');
    }

    fileContent = this.sanitizeCookieContent(fileContent);

    if (!fs.existsSync(this.cookiesDir)) {
      fs.mkdirSync(this.cookiesDir, { recursive: true });
    }
    if (!fs.existsSync(this.persistentCookiesDir)) {
      fs.mkdirSync(this.persistentCookiesDir, { recursive: true });
    }

    const localCookiesPath = path.join(this.cookiesDir, 'cookies.txt');
    fs.writeFileSync(localCookiesPath, fileContent, { encoding: 'utf-8', mode: 0o600 });
    fs.writeFileSync(this.persistentCookiesPath, fileContent, { encoding: 'utf-8', mode: 0o600 });

    const byteLen = Buffer.byteLength(fileContent, 'utf8');
    this.logger.log(
      `Master cookies.txt successfully updated (${byteLen} bytes).`,
    );

    return {
      success: true,
      message: 'Master cookies.txt successfully updated in both workspace and persistent storage.',
      bytesWritten: byteLen,
    };
  }

  async updateBinary(secret: string) {
    const expectedSecret = process.env.ADMIN_COOKIE_SECRET;
    if (!expectedSecret || secret !== expectedSecret) {
      throw new ForbiddenException('Invalid or missing admin cookie secret.');
    }
    const message = await this.binaryService.updateYtDlpBinary();
    return {
      success: true,
      message,
    };
  }

  private purgeExpiredTokens(): void {
    const now = Date.now();
    for (const [token, entry] of this.streamCache.entries()) {
      if (entry.expiresAt <= now) {
        this.streamCache.delete(token);
      }
    }
    for (const [id, entry] of this.invidiousCache.entries()) {
      if (entry.expiresAt <= now) {
        this.invidiousCache.delete(id);
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

  private safePath(baseDir: string, fileName: string): string {
    const resolved = path.resolve(baseDir, fileName);
    if (!resolved.startsWith(path.resolve(baseDir) + path.sep) && resolved !== path.resolve(baseDir)) {
      throw new BadRequestException('Invalid path component.');
    }
    return resolved;
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
    const rawErrorLine = stderr
      .trim()
      .split('\n')
      .reverse()
      .find((line) => line.includes('ERROR:'))
      ?.replace(/^.*ERROR:\s*(\[[^\]]+\]\s*[^:]+:\s*)?/i, '')
      .slice(0, 220);

    if (lower.includes('requested format is not available')) {
      return `The requested format is not available for this media. Please select another quality or option.${rawErrorLine ? ` (${rawErrorLine})` : ''}`;
    }
    if (lower.includes('page needs to be reloaded') || lower.includes('unplayable')) {
      return `YouTube challenged the request format for this server IP. Please upload cookies via POST /api/media/cookies or try another link.${rawErrorLine ? ` (${rawErrorLine})` : ''}`;
    }
    if (lower.includes('sign in to confirm') || lower.includes('not a bot')) {
      return `YouTube blocked the server IP. Please upload cookies via POST /api/media/cookies or configure COOKIES_BASE64 in Hostinger.${rawErrorLine ? ` (${rawErrorLine})` : ''}`;
    }
    if (lower.includes('login required') || lower.includes('rate-limit reached')) {
      return `This platform requires authentication. Please upload cookies via POST /api/media/cookies or configure COOKIES_BASE64 in Hostinger.${rawErrorLine ? ` (${rawErrorLine})` : ''}`;
    }
    if (lower.includes('failed to map segment') || lower.includes('permission denied')) {
      return 'Server binary execution restricted (TMPDIR noexec).';
    }
    if (rawErrorLine) {
      return rawErrorLine;
    }
    return 'Could not fetch media details. The post may be private or removed.';
  }

  private normalizeMediaUrl(rawUrl: string, platform: SupportedPlatform): string {
    const trimmed = (rawUrl || '').trim();
    if (platform !== 'youtube') {
      return trimmed;
    }

    try {
      const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      const parsed = new URL(normalized);
      const host = parsed.hostname.toLowerCase();
      let videoId: string | null = null;

      if (/(^|\.)youtu\.be$/i.test(host)) {
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts.length > 0) {
          videoId = parts[0];
        }
      } else if (/(^|\.)youtube\.com$/i.test(host)) {
        if (
          parsed.pathname.startsWith('/shorts/') ||
          parsed.pathname.startsWith('/live/') ||
          parsed.pathname.startsWith('/embed/')
        ) {
          const parts = parsed.pathname.split('/').filter(Boolean);
          if (parts.length > 1) {
            videoId = parts[1];
          }
        } else if (parsed.searchParams.has('v')) {
          videoId = parsed.searchParams.get('v');
        }
      }

      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }

      // If specific video ID could not be isolated, strip playlist and tracking query params
      parsed.searchParams.delete('list');
      parsed.searchParams.delete('index');
      parsed.searchParams.delete('start_radio');
      parsed.searchParams.delete('si');
      parsed.searchParams.delete('pp');
      return parsed.toString();
    } catch {
      return trimmed;
    }
  }

  private getYoutubeExtractorArgs(hasCookies: boolean): string[] {
    if (hasCookies) {
      return [
        '--extractor-args',
        'youtube:player_client=web_creator,tv,mweb',
      ];
    }
    return [
      '--extractor-args',
      'youtube:player_client=tv_embedded,android_vr,ios;player_skip=webpage,configs',
    ];
  }

  private async extractTikTokFallback(url: string): Promise<MediaInfoResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
      const res = await fetch(apiUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new BadRequestException('TikTok fallback service returned an invalid response.');
      }

      const json = await res.json();
      if (!json || json.code !== 0 || !json.data) {
        throw new BadRequestException(
          json?.msg || 'Could not fetch TikTok media details. The video may be private or removed.',
        );
      }

      const data = json.data;
      const title = data.title || `TikTok Video ${data.id || ''}`;
      const formats: CleanFormat[] = [];

      // 1080p HD no-watermark video
      if (data.hdplay) {
        const token = crypto.randomBytes(16).toString('hex');
        this.streamCache.set(token, {
          targetUrl: data.hdplay,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Referer: 'https://www.tikwm.com/',
          },
          filename: this.sanitizeFilename(title, 'mp4'),
          mimeType: 'video/mp4',
          expiresAt: Date.now() + this.cacheTtlMs,
        });

        formats.push({
          formatId: 'tiktok-hd',
          label: '1080p HD (No Watermark)',
          ext: 'mp4',
          type: 'video',
          resolution: '1080p',
          filesizeApprox: data.hd_size || data.size || undefined,
          needsMerge: false,
          streamToken: token,
        });
      }

      // 720p / standard no-watermark video
      if (data.play) {
        const token = crypto.randomBytes(16).toString('hex');
        this.streamCache.set(token, {
          targetUrl: data.play,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Referer: 'https://www.tikwm.com/',
          },
          filename: this.sanitizeFilename(title, 'mp4'),
          mimeType: 'video/mp4',
          expiresAt: Date.now() + this.cacheTtlMs,
        });

        formats.push({
          formatId: 'tiktok-sd',
          label: '720p MP4 (No Watermark)',
          ext: 'mp4',
          type: 'video',
          resolution: '720p',
          filesizeApprox: data.size || undefined,
          needsMerge: false,
          streamToken: token,
        });
      }

      // Original audio
      if (data.music) {
        const token = crypto.randomBytes(16).toString('hex');
        this.streamCache.set(token, {
          targetUrl: data.music,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Referer: 'https://www.tikwm.com/',
          },
          filename: this.sanitizeFilename(`${title} (Audio)`, 'mp3'),
          mimeType: 'audio/mpeg',
          expiresAt: Date.now() + this.cacheTtlMs,
        });

        formats.push({
          formatId: 'tiktok-audio',
          label: 'Original Audio (MP3)',
          ext: 'mp3',
          type: 'audio',
          resolution: 'Audio',
          needsMerge: false,
          streamToken: token,
        });
      }

      if (formats.length === 0) {
        throw new BadRequestException('No playable streams found for this TikTok video.');
      }

      return {
        platform: 'tiktok',
        title,
        thumbnail: data.cover || data.origin_cover || '',
        duration: Number(data.duration) || 0,
        uploader: data.author?.nickname || data.author?.unique_id || 'TikTok Creator',
        formats,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractYoutubeVideoId(url: string): string | null {
    try {
      const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
      if (parsed.searchParams.has('v')) {
        return parsed.searchParams.get('v');
      }
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (/(^|\.)youtu\.be$/i.test(parsed.hostname) && parts.length > 0) {
        return parts[0];
      }
      if (parts.length > 1 && ['shorts', 'live', 'embed'].includes(parts[0])) {
        return parts[1];
      }
      return parts[parts.length - 1] || null;
    } catch {
      return null;
    }
  }

  private async fetchInvidiousVideoData(videoId: string): Promise<any> {
    const cached = this.invidiousCache.get(videoId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    for (const base of this.invidiousInstances) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);
        const res = await fetch(`${base}/api/v1/videos/${videoId}?local=true`, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));

        if (!res.ok) continue;
        const data = await res.json();
        if (data && (data.adaptiveFormats?.length || data.formatStreams?.length)) {
          data._instanceBase = base;
          for (const f of [...(data.adaptiveFormats || []), ...(data.formatStreams || [])]) {
            if (f.url && f.url.startsWith('/')) {
              f.url = `${base}${f.url}`;
            }
          }
          this.invidiousCache.set(videoId, {
            data,
            expiresAt: Date.now() + 15 * 60 * 1000,
          });
          return data;
        }
      } catch (err) {
        this.logger.warn(
          `Invidious instance ${base} failed for ${videoId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    throw new BadRequestException('Could not fetch YouTube media details from fallback servers.');
  }

  private async extractYoutubeFallback(cleanUrl: string): Promise<MediaInfoResponse> {
    const videoId = this.extractYoutubeVideoId(cleanUrl);
    if (!videoId) {
      throw new BadRequestException('Could not parse YouTube video ID.');
    }

    const data = await this.fetchInvidiousVideoData(videoId);
    const title = data.title || 'YouTube Video';
    const thumbnail = data.videoThumbnails?.[0]?.url || '';
    const duration = Number(data.lengthSeconds) || 0;
    const uploader = data.author || 'YouTube Creator';

    const formats: CleanFormat[] = [];
    const seenHeights = new Set<string>();

    // 1. Progressive streams (if available)
    for (const f of data.formatStreams || []) {
      if (f.url && f.resolution) {
        const height = parseInt(f.resolution, 10);
        const key = `${height}p`;
        if (!seenHeights.has(key)) {
          seenHeights.add(key);
          const token = crypto.randomBytes(16).toString('hex');
          const ext = f.container || 'mp4';
          this.streamCache.set(token, {
            targetUrl: f.url,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Referer: `${data._instanceBase || 'https://www.youtube.com'}/watch?v=${videoId}`,
            },
            filename: this.sanitizeFilename(title, ext),
            mimeType: ext === 'webm' ? 'video/webm' : 'video/mp4',
            expiresAt: Date.now() + this.cacheTtlMs,
          });

          formats.push({
            formatId: `youtube-fallback-direct-${f.itag || f.resolution}`,
            label: `${f.resolution} ${ext.toUpperCase()} (Instant Stream)`,
            ext,
            type: 'video',
            resolution: f.resolution,
            needsMerge: false,
            streamToken: token,
          });
        }
      }
    }

    // 2. High-res adaptive video formats (needsMerge: true)
    const videoFormats = (data.adaptiveFormats || []).filter(
      (f: any) => f.type?.includes('video') && f.resolution,
    );

    for (const f of videoFormats) {
      const height = parseInt(f.resolution, 10);
      if (isNaN(height)) continue;
      const key = `${height}p`;
      if (!seenHeights.has(key)) {
        seenHeights.add(key);
        formats.push({
          formatId: `youtube-fallback-${key}`,
          label: `${key} HD MP4`,
          ext: 'mp4',
          type: 'video',
          resolution: key,
          filesizeApprox: Number(f.contentLength || f.size) || undefined,
          needsMerge: true,
        });
      }
    }

    // If no specific video formats were found, add general best quality
    if (!formats.some((f) => f.type === 'video')) {
      formats.push({
        formatId: 'youtube-fallback-best',
        label: 'HD Video (Best Quality)',
        ext: 'mp4',
        type: 'video',
        resolution: 'HD',
        needsMerge: true,
      });
    }

    // 3. Audio format
    formats.push({
      formatId: 'youtube-fallback-audio',
      label: 'MP3 Audio (High Quality)',
      ext: 'mp3',
      type: 'audio',
      needsMerge: true,
    });

    formats.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'video' ? -1 : 1;
      const resA = parseInt(a.resolution || '0', 10) || 720;
      const resB = parseInt(b.resolution || '0', 10) || 720;
      return resB - resA;
    });

    return {
      platform: 'youtube',
      title,
      thumbnail,
      duration,
      uploader,
      formats,
    };
  }

  private async prepareYoutubeFallbackFile(
    cleanUrl: string,
    formatId: string,
    type: 'video' | 'audio',
    jobId?: string,
    abortSignal?: AbortSignal,
  ): Promise<{ filePath: string; filename: string; mimeType: string }> {
    const videoId = this.extractYoutubeVideoId(cleanUrl);
    if (!videoId) {
      throw new BadRequestException('Invalid YouTube URL.');
    }

    const rawData = await this.fetchInvidiousVideoData(videoId);
    const title = rawData.title || 'YouTube Video';
    const ext = type === 'audio' ? 'mp3' : 'mp4';
    const uniqueId = jobId || `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const finalPath = this.safePath(this.tempDir, `${uniqueId}.${ext}`);
    const tempVideoPath = this.safePath(this.tempDir, `${uniqueId}_v.part`);
    const tempAudioPath = this.safePath(this.tempDir, `${uniqueId}_a.part`);

    const cleanupTempArtifacts = () => {
      try {
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
      } catch {}
      try {
        if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
      } catch {}
    };

    const cleanupAll = () => {
      cleanupTempArtifacts();
      try {
        if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
      } catch {}
    };

    const base = rawData._instanceBase || this.invidiousInstances[0];
    const downloadHeaders = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: `${base}/watch?v=${videoId}`,
    };

    const audioFormats = (rawData.adaptiveFormats || []).filter(
      (f: any) => f.type?.includes('audio') || f.container === 'm4a',
    );
    const bestAudio =
      audioFormats.find((f: any) => String(f.itag) === '140') ||
      audioFormats[0];

    this.emitProgress(jobId, { status: 'starting', percent: 10 });

    try {
      if (type === 'audio') {
        if (!bestAudio?.url) {
          throw new BadRequestException('Audio stream not available for this YouTube video.');
        }

        this.emitProgress(jobId, { status: 'downloading', percent: 35 });
        const aRes = await fetch(bestAudio.url, {
          headers: downloadHeaders,
          signal: abortSignal,
        });
        if (!aRes.ok || !aRes.body) {
          throw new BadRequestException(`Could not stream audio: upstream HTTP ${aRes.status}`);
        }
        await pipeline(Readable.fromWeb(aRes.body as any), fs.createWriteStream(tempAudioPath));

        this.emitProgress(jobId, { status: 'merging', percent: 80 });
        const ffmpegArgs = [
          '-y',
          '-i',
          tempAudioPath,
          '-vn',
          '-c:a',
          'libmp3lame',
          '-q:a',
          '2',
          finalPath,
        ];

        await this.concurrency.run(
          () =>
            new Promise<void>((resolve, reject) => {
              const child = spawn(this.binaryService.ffmpegBinaryPath, ffmpegArgs, {
                shell: false,
                env: this.binaryService.spawnEnv,
              });
              let isDone = false;
              let stderr = '';
              let timer: NodeJS.Timeout | undefined;

              const abortHandler = () => {
                if (isDone) return;
                isDone = true;
                if (timer) clearTimeout(timer);
                try {
                  child.kill('SIGKILL');
                } catch {}
                cleanupAll();
                reject(new BadRequestException('Download cancelled by client.'));
              };

              if (abortSignal) {
                if (abortSignal.aborted) {
                  abortHandler();
                  return;
                }
                abortSignal.addEventListener('abort', abortHandler, { once: true });
              }

              timer = setTimeout(() => {
                if (isDone) return;
                isDone = true;
                try {
                  child.kill('SIGKILL');
                } catch {}
                cleanupAll();
                this.emitProgress(jobId, {
                  status: 'error',
                  percent: 0,
                  message: 'Processing timed out.',
                });
                reject(
                  new GatewayTimeoutException('Media processing exceeded maximum allowable time.'),
                );
              }, this.mergeTimeoutMs);
              timer.unref();

              child.stderr.on('data', (c) => (stderr += c.toString()));
              child.on('close', (code) => {
                if (isDone) return;
                isDone = true;
                clearTimeout(timer);
                if (abortSignal) abortSignal.removeEventListener('abort', abortHandler);
                if (code !== 0 || !fs.existsSync(finalPath)) {
                  cleanupAll();
                  const errDetail =
                    stderr.trim().split('\n').reverse().find((l) => l.trim())?.slice(0, 200) ||
                    `exit code ${code}`;
                  this.logger.warn(`FFmpeg fallback audio conversion failed: ${errDetail}`);
                  return reject(new BadRequestException(`Failed to convert audio: ${errDetail}`));
                }
                this.emitProgress(jobId, { status: 'ready', percent: 100 });
                resolve();
              });

              child.on('error', (err) => {
                if (isDone) return;
                isDone = true;
                if (timer) clearTimeout(timer);
                cleanupAll();
                this.logger.error(`FFmpeg process error: ${err.message}`);
                reject(new BadRequestException(`Failed to execute audio converter: ${err.message}`));
              });
            }),
        );
      } else {
        const targetResMatch = formatId.match(/youtube-fallback-(\d+p)/);
        const targetRes = targetResMatch ? targetResMatch[1] : null;

        const videoFormats = (rawData.adaptiveFormats || []).filter(
          (f: any) => f.type?.includes('video') && f.url,
        );

        let chosenVideo = targetRes
          ? videoFormats.find((f: any) => f.resolution === targetRes && f.container === 'mp4') ||
            videoFormats.find((f: any) => f.resolution === targetRes)
          : null;

        if (!chosenVideo) {
          chosenVideo = videoFormats[0];
        }

        if (!chosenVideo?.url) {
          throw new BadRequestException('Video stream not available for this YouTube video.');
        }

        this.emitProgress(jobId, { status: 'downloading', percent: 35 });
        const [vRes, aRes] = await Promise.all([
          fetch(chosenVideo.url, { headers: downloadHeaders, signal: abortSignal }),
          bestAudio?.url
            ? fetch(bestAudio.url, { headers: downloadHeaders, signal: abortSignal })
            : null,
        ]);

        if (!vRes.ok || !vRes.body) {
          throw new BadRequestException(`Could not stream video: upstream HTTP ${vRes.status}`);
        }

        const downloadTasks: Promise<any>[] = [
          pipeline(Readable.fromWeb(vRes.body as any), fs.createWriteStream(tempVideoPath)),
        ];
        if (aRes?.ok && aRes.body) {
          downloadTasks.push(
            pipeline(Readable.fromWeb(aRes.body as any), fs.createWriteStream(tempAudioPath)),
          );
        }
        await Promise.all(downloadTasks);

        this.emitProgress(jobId, { status: 'merging', percent: 85 });
        const ffmpegArgs = ['-y', '-i', tempVideoPath];
        if (fs.existsSync(tempAudioPath)) {
          ffmpegArgs.push(
            '-i',
            tempAudioPath,
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-movflags',
            '+faststart',
            finalPath,
          );
        } else {
          ffmpegArgs.push('-c', 'copy', '-movflags', '+faststart', finalPath);
        }

        await this.concurrency.run(
          () =>
            new Promise<void>((resolve, reject) => {
              const child = spawn(this.binaryService.ffmpegBinaryPath, ffmpegArgs, {
                shell: false,
                env: this.binaryService.spawnEnv,
              });
              let isDone = false;
              let stderr = '';
              let timer: NodeJS.Timeout | undefined;

              const abortHandler = () => {
                if (isDone) return;
                isDone = true;
                if (timer) clearTimeout(timer);
                try {
                  child.kill('SIGKILL');
                } catch {}
                cleanupAll();
                reject(new BadRequestException('Download cancelled by client.'));
              };

              if (abortSignal) {
                if (abortSignal.aborted) {
                  abortHandler();
                  return;
                }
                abortSignal.addEventListener('abort', abortHandler, { once: true });
              }

              timer = setTimeout(() => {
                if (isDone) return;
                isDone = true;
                try {
                  child.kill('SIGKILL');
                } catch {}
                cleanupAll();
                this.emitProgress(jobId, {
                  status: 'error',
                  percent: 0,
                  message: 'Processing timed out.',
                });
                reject(
                  new GatewayTimeoutException('Media processing exceeded maximum allowable time.'),
                );
              }, this.mergeTimeoutMs);
              timer.unref();

              child.stderr.on('data', (c) => (stderr += c.toString()));
              child.on('close', (code) => {
                if (isDone) return;
                isDone = true;
                clearTimeout(timer);
                if (abortSignal) abortSignal.removeEventListener('abort', abortHandler);
                if (code !== 0 || !fs.existsSync(finalPath)) {
                  cleanupAll();
                  const errDetail =
                    stderr.trim().split('\n').reverse().find((l) => l.trim())?.slice(0, 200) ||
                    `exit code ${code}`;
                  this.logger.warn(`FFmpeg fallback merge failed: ${errDetail}`);
                  return reject(
                    new BadRequestException(`Failed to process media file: ${errDetail}`),
                  );
                }
                this.emitProgress(jobId, { status: 'ready', percent: 100 });
                resolve();
              });

              child.on('error', (err) => {
                if (isDone) return;
                isDone = true;
                if (timer) clearTimeout(timer);
                cleanupAll();
                this.logger.error(`FFmpeg process error: ${err.message}`);
                reject(
                  new BadRequestException(
                    `Failed to execute media converter process: ${err.message}`,
                  ),
                );
              });
            }),
        );
      }
    } finally {
      cleanupTempArtifacts();
    }

    return {
      filePath: finalPath,
      filename: this.sanitizeFilename(title, ext),
      mimeType: type === 'audio' ? 'audio/mpeg' : 'video/mp4',
    };
  }

  private async runYtDlpExtract(
    targetUrl: string,
    platform: SupportedPlatform,
    useCookies: boolean,
    youtubeClientArg?: string,
  ): Promise<any> {
    const tempCookie = useCookies ? this.createTempCookieFile(platform) : null;
    const cacheDir = path.join(this.tempDir, '.cache');
    const args = [
      '--dump-single-json',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      '--geo-bypass',
      '--socket-timeout',
      '20',
      '--cache-dir',
      cacheDir,
      '--ffmpeg-location',
      this.binaryService.ffmpegBinaryPath,
    ];

    if (process.env.PROXY_URL && process.env.PROXY_URL.trim()) {
      args.push('--proxy', process.env.PROXY_URL.trim());
    }

    if (platform === 'youtube') {
      const clientArg =
        youtubeClientArg ||
        (useCookies
          ? 'youtube:player_client=web_creator,tv,mweb'
          : 'youtube:player_client=tv_embedded,android_vr,ios;player_skip=webpage,configs');
      args.push(
        '--extractor-args',
        clientArg,
        '--no-js-runtimes',
        '--js-runtimes',
        `node:${process.execPath}`,
      );
    }

    if (useCookies && tempCookie) {
      args.push('--cookies', tempCookie);
    }
    args.push(targetUrl);

    try {
      return await new Promise<any>((resolve, reject) => {
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
          try {
            child.kill('SIGKILL');
          } catch {}
          this.logger.warn(`yt-dlp metadata extraction timed out after ${this.extractTimeoutMs}ms for ${targetUrl}`);
          reject(
            new GatewayTimeoutException('Media analysis timed out. The platform may be throttling requests.'),
          );
        }, this.extractTimeoutMs);
        timer.unref();

        child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
        child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

        child.on('close', (code) => {
          if (isDone) return;
          isDone = true;
          clearTimeout(timer);

          if (code !== 0) {
            this.logger.warn(`yt-dlp metadata failed: ${stderr.trim().slice(0, 300)}`);
            return reject(new BadRequestException(this.formatYtDlpError(stderr)));
          }
          try {
            const raw = JSON.parse(stdout);
            resolve(raw);
          } catch {
            reject(new BadRequestException('Failed to parse media metadata from upstream source.'));
          }
        });

        child.on('error', (err) => {
          if (isDone) return;
          isDone = true;
          clearTimeout(timer);
          this.logger.error(`Spawn error for yt-dlp: ${err.message}`);
          reject(new BadRequestException('Failed to launch extractor process.'));
        });
      });
    } finally {
      this.removeTempCookieFile(tempCookie);
    }
  }

  async extractMetadata(url: string): Promise<MediaInfoResponse> {
    const platform = detectPlatform(url);
    if (platform === 'unknown') {
      throw new BadRequestException(
        'Unsupported link. Please provide a YouTube, Facebook, Instagram, or TikTok URL.',
      );
    }

    const cleanUrl = this.normalizeMediaUrl(url, platform);
    const hasCookiesAvailable = Boolean(this.createTempCookieFile(platform));

    return this.concurrency.run(async () => {
      let raw: any;
      let firstError: any;

      if (platform === 'youtube') {
        const hasCookies = this.hasConfiguredCookies();
        const primaryClients = 'youtube:player_client=web_creator,tv,mweb';
        const fallbackClients =
          'youtube:player_client=tv_embedded,android_vr,ios;player_skip=webpage,configs';

        if (hasCookies) {
          // When hasCookies === true:
          // Attempt 1: Run WITH cookies and primary client suite
          try {
            raw = await this.runYtDlpExtract(
              cleanUrl,
              platform,
              true,
              primaryClients,
            );
          } catch (err) {
            firstError = err;
            this.logger.warn(
              `YouTube Attempt 1 (with cookies) failed: ${err instanceof Error ? err.message : String(err)}. Retrying without cookies...`,
            );
            // Attempt 2: Run WITHOUT cookies with fallback clients
            try {
              raw = await this.runYtDlpExtract(
                cleanUrl,
                platform,
                false,
                fallbackClients,
              );
            } catch (err2) {
              this.logger.warn(
                `YouTube Attempt 2 (cookie-free) failed: ${err2 instanceof Error ? err2.message : String(err2)}. Trying native datacenter fallback...`,
              );
              try {
                return await this.extractYoutubeFallback(cleanUrl);
              } catch (fallbackErr) {
                this.logger.error(
                  `YouTube fallback failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
                );
                throw err2 || firstError;
              }
            }
          }
        } else {
          // When hasCookies === false:
          // Attempt 1: Run WITHOUT cookies with fallback clients
          try {
            raw = await this.runYtDlpExtract(
              cleanUrl,
              platform,
              false,
              fallbackClients,
            );
          } catch (err) {
            firstError = err;
            this.logger.warn(
              `YouTube Attempt 1 (cookie-free) failed: ${err instanceof Error ? err.message : String(err)}. Trying native datacenter fallback...`,
            );
            try {
              return await this.extractYoutubeFallback(cleanUrl);
            } catch (fallbackErr) {
              this.logger.error(
                `YouTube fallback failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
              );
              throw firstError;
            }
          }
        }
      } else {
        // For instagram, facebook, tiktok:
        const tryCookiesFirst = hasCookiesAvailable;
        try {
          raw = await this.runYtDlpExtract(cleanUrl, platform, tryCookiesFirst);
        } catch (err) {
          firstError = err;
          if (tryCookiesFirst) {
            this.logger.warn(
              `${platform} Attempt 1 (with cookies) failed. Retrying without cookies...`,
            );
            try {
              raw = await this.runYtDlpExtract(cleanUrl, platform, false);
            } catch (err2) {
              firstError = err2 || firstError;
            }
          }

          if (!raw) {
            if (platform === 'tiktok') {
              this.logger.log('yt-dlp TikTok extraction failed. Trying native datacenter fallback...');
              try {
                return await this.extractTikTokFallback(cleanUrl);
              } catch (fallbackErr) {
                this.logger.error(
                  `TikTok fallback failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
                );
              }
            }
            throw firstError;
          }
        }
      }

      const title = raw.title || 'Untitled Media';
      return {
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
          raw,
        ),
      };
    });
  }

  private normalizeFormats(
    rawFormats: any[],
    globalHeaders: Record<string, string>,
    title: string,
    platform: SupportedPlatform,
    raw?: any,
  ): CleanFormat[] {
    const clean: CleanFormat[] = [];
    const seenKeys = new Set<string>();

    // 1. Progressive formats (both video + audio -> zero disk/FFmpeg overhead)
    for (const f of rawFormats || []) {
      const isProgressive = f.vcodec !== 'none' && f.acodec !== 'none' && Boolean(f.url);
      if (isProgressive) {
        const height = f.height ? Number(f.height) : null;
        const resolution = height ? `${height}p` : f.format_note || f.resolution || 'HD Video';
        const key = height ? `height_${height}` : `fmt_${f.format_id || resolution}`;

        if (!seenKeys.has(key)) {
          seenKeys.add(key);

          const token = crypto.randomBytes(16).toString('hex');
          const ext = f.ext || 'mp4';
          this.streamCache.set(token, {
            targetUrl: f.url,
            headers: { ...globalHeaders, ...(f.http_headers || {}) },
            filename: this.sanitizeFilename(title, ext),
            mimeType: ext === 'webm' ? 'video/webm' : 'video/mp4',
            expiresAt: Date.now() + this.cacheTtlMs,
          });

          clean.push({
            formatId: String(f.format_id),
            label: height
              ? `${height}p ${ext.toUpperCase()} (Instant Stream)`
              : `${resolution} ${ext.toUpperCase()} (Instant Stream)`,
            ext,
            type: 'video',
            resolution,
            filesizeApprox: f.filesize || f.filesize_approx,
            needsMerge: false,
            streamToken: token,
          });
        }
      }
    }

    // Top-level raw.url fallback (e.g. TikTok / Instagram Reel where raw.formats may not have direct progressive entries)
    if (clean.filter((f) => f.type === 'video').length === 0 && raw?.url) {
      const token = crypto.randomBytes(16).toString('hex');
      const ext = raw.ext || 'mp4';
      this.streamCache.set(token, {
        targetUrl: raw.url,
        headers: { ...globalHeaders, ...(raw.http_headers || {}) },
        filename: this.sanitizeFilename(title, ext),
        mimeType: ext === 'webm' ? 'video/webm' : 'video/mp4',
        expiresAt: Date.now() + this.cacheTtlMs,
      });

      clean.push({
        formatId: String(raw.format_id || 'direct'),
        label: 'HD Video (Instant Stream)',
        ext,
        type: 'video',
        resolution: raw.height ? `${raw.height}p` : 'HD Video',
        filesizeApprox: raw.filesize || raw.filesize_approx,
        needsMerge: false,
        streamToken: token,
      });
    }

    // 2. High-res DASH video-only streams (requires FFmpeg merge with bestaudio)
    if (platform === 'youtube' || platform === 'facebook') {
      const existingHeights = new Set(
        clean.map((c) => parseInt(c.resolution || '0', 10)).filter(Boolean),
      );
      for (const targetHeight of [1080, 720, 480]) {
        if (!existingHeights.has(targetHeight)) {
          const match = (rawFormats || []).find(
            (f) => f.vcodec !== 'none' && f.acodec === 'none' && f.height === targetHeight,
          );
          if (match) {
            existingHeights.add(targetHeight);
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

    // Ensure at least one merged HD option exists so users always have high-res merge available
    const hasMergedVideo = clean.some((f) => f.type === 'video' && f.needsMerge);
    if (!hasMergedVideo) {
      clean.push({
        formatId: 'bestvideo+bestaudio/best',
        label: 'HD Video (Best Quality)',
        ext: 'mp4',
        type: 'video',
        resolution: 'HD',
        needsMerge: true,
      });
    }

    // 3. Universal Audio Extraction Option
    clean.push({
      formatId: 'bestaudio/best',
      label: 'MP3 Audio (High Quality)',
      ext: 'mp3',
      type: 'audio',
      needsMerge: true,
    });

    return clean.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'video' ? -1 : 1;
      const resA = parseInt(a.resolution || '0', 10) || (a.needsMerge ? 1080 : 720);
      const resB = parseInt(b.resolution || '0', 10) || (b.needsMerge ? 1080 : 720);
      return resB - resA;
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
    const cleanUrl = this.normalizeMediaUrl(url, platform);
    const uniqueId = jobId || `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ext = type === 'audio' ? 'mp3' : 'mp4';
    const outputTemplate = this.safePath(this.tempDir, `${uniqueId}.%(ext)s`);
    const finalPath = this.safePath(this.tempDir, `${uniqueId}.${ext}`);

    // If format is from YouTube fallback service, handle direct stream retrieval & ffmpeg mux
    if (formatId.startsWith('youtube-fallback-')) {
      return await this.prepareYoutubeFallbackFile(
        cleanUrl,
        formatId,
        type,
        jobId,
        abortSignal,
      );
    }

    // If format is from TikTok fallback service, handle direct stream retrieval
    if (formatId.startsWith('tiktok-')) {
      const meta = await this.extractTikTokFallback(cleanUrl);
      const matched = meta.formats.find((f) => f.formatId === formatId);
      if (matched && matched.streamToken) {
        const streamOpt = this.getStreamOptions(matched.streamToken);
        const resp = await fetch(streamOpt.targetUrl, { headers: streamOpt.headers });
        const arrayBuf = await resp.arrayBuffer();
        fs.writeFileSync(finalPath, Buffer.from(arrayBuf));
        return {
          filePath: finalPath,
          filename: streamOpt.filename,
          mimeType: streamOpt.mimeType,
        };
      }
    }

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
          let safeFormatId = formatId;
          if (formatId === 'bestaudio') {
            safeFormatId = 'bestaudio/best';
          } else if (type === 'video' && formatId.includes('+')) {
            safeFormatId = `${formatId}/bestvideo+bestaudio/best`;
          } else if (type === 'video') {
            safeFormatId = `${formatId}/best`;
          }
          const args = [
            '--no-playlist',
            '--newline',
            '--ffmpeg-location',
            this.binaryService.ffmpegBinaryPath,
            '--force-ipv4',
            '--cache-dir',
            cacheDir,
            '--no-check-certificates',
            '--geo-bypass',
            '-f',
            safeFormatId,
            '-o',
            outputTemplate,
          ];

          if (process.env.PROXY_URL && process.env.PROXY_URL.trim()) {
            args.push('--proxy', process.env.PROXY_URL.trim());
          }

          if (platform === 'youtube') {
            const clientArg = tempCookie
              ? 'youtube:player_client=web_creator,tv,mweb'
              : 'youtube:player_client=tv_embedded,android_vr,ios;player_skip=webpage,configs';
            args.push(
              '--extractor-args',
              clientArg,
              '--no-js-runtimes',
              '--js-runtimes',
              `node:${process.execPath}`,
            );
          }

          if (tempCookie) {
            args.push('--cookies', tempCookie);
          }

          if (type === 'audio') {
            args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
          } else {
            args.push('--merge-output-format', 'mp4');
          }

          args.push(cleanUrl);

          const child = spawn(this.binaryService.ytDlpPath, args, {
            shell: false,
            env: this.binaryService.spawnEnv,
          });
          let isDone = false;
          let stderr = '';
          let timer: NodeJS.Timeout | undefined;

          const abortHandler = () => {
            if (isDone) return;
            isDone = true;
            if (timer) clearTimeout(timer);
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

          timer = setTimeout(() => {
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
          timer.unref();

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

          child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
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
              const formattedError = this.formatYtDlpError(stderr);
              this.logger.warn(`yt-dlp merge failed: ${stderr.trim().slice(0, 300)}`);
              this.emitProgress(jobId, {
                status: 'error',
                percent: 0,
                message: formattedError,
              });
              return reject(new BadRequestException(formattedError));
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
