import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
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
export class MediaService implements OnModuleDestroy {
  private readonly logger = new Logger(MediaService.name);
  private readonly tempDir = path.join(process.cwd(), 'temp');
  private readonly jobStreams = new Map<string, Subject<JobProgress>>();
  private readonly streamCache = new Map<string, CachedStreamEntry>();
  private readonly cacheTtlMs = 20 * 60 * 1000; // 20 minutes
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(
    private readonly binaryService: BinaryService,
    private readonly concurrency: ConcurrencyService,
  ) {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    // Periodically purge expired stream tokens so RAM stays flat on Hostinger
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [token, entry] of this.streamCache.entries()) {
        if (entry.expiresAt <= now) {
          this.streamCache.delete(token);
        }
      }
    }, 5 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
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
          const args = [
            '--dump-single-json',
            '--no-playlist',
            '--no-warnings',
            url,
          ];

          const child = spawn(this.binaryService.ytDlpPath, args, { shell: false });
          let stdout = '';
          let stderr = '';

          child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
          child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

          child.on('close', (code) => {
            if (code !== 0) {
              this.logger.warn(`yt-dlp metadata failed: ${stderr}`);
              return reject(
                new BadRequestException('Could not fetch media details. The post may be private.'),
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
              reject(new BadRequestException('Failed to parse media metadata.'));
            }
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

    // 1. Progressive formats (already contain both video + audio -> zero disk/FFmpeg overhead)
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
  ): Promise<{ filePath: string; filename: string; mimeType: string }> {
    const uniqueId = jobId || `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ext = type === 'audio' ? 'mp3' : 'mp4';
    const outputTemplate = path.join(this.tempDir, `${uniqueId}.%(ext)s`);
    const finalPath = path.join(this.tempDir, `${uniqueId}.${ext}`);

    this.emitProgress(jobId, { status: 'starting', percent: 5 });

    await this.concurrency.run(
      () =>
        new Promise<void>((resolve, reject) => {
          const args = [
            '--no-playlist',
            '--newline',
            '--ffmpeg-location',
            this.binaryService.ffmpegBinaryPath,
            '-f',
            formatId,
            '-o',
            outputTemplate,
          ];

          if (type === 'audio') {
            args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
          } else {
            args.push('--merge-output-format', 'mp4');
          }

          args.push(url);

          const child = spawn(this.binaryService.ytDlpPath, args, { shell: false });

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
            if (code !== 0 || !fs.existsSync(finalPath)) {
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
        }),
    );

    return {
      filePath: finalPath,
      filename: `media_${uniqueId}.${ext}`,
      mimeType: type === 'audio' ? 'audio/mpeg' : 'video/mp4',
    };
  }
}
