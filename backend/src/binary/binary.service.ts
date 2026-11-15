import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegStatic = require('ffmpeg-static');
const ffmpegPath: string = ffmpegStatic?.default || ffmpegStatic;

@Injectable()
export class BinaryService implements OnModuleInit {
  private readonly logger = new Logger(BinaryService.name);
  private readonly binDir = path.join(process.cwd(), 'bin');
  private readonly minBinarySizeBytes = 1024 * 1024; // 1MB minimum valid executable size
  private readonly downloadTimeoutMs = 60000; // 60s timeout for binary download

  get ytDlpBinaryName(): string {
    if (process.platform === 'win32') return 'yt-dlp.exe';
    if (process.platform === 'darwin') return 'yt-dlp_macos';
    return 'yt-dlp_linux';
  }

  get ytDlpPath(): string {
    return path.join(this.binDir, this.ytDlpBinaryName);
  }

  get ffmpegBinaryPath(): string {
    if (!ffmpegPath) {
      throw new Error('ffmpeg-static binary could not be resolved.');
    }
    return ffmpegPath;
  }

  async onModuleInit(): Promise<void> {
    if (!fs.existsSync(this.binDir)) {
      fs.mkdirSync(this.binDir, { recursive: true });
    }

    let needsDownload = true;
    if (fs.existsSync(this.ytDlpPath)) {
      try {
        const stats = fs.statSync(this.ytDlpPath);
        if (stats.size >= this.minBinarySizeBytes) {
          needsDownload = false;
        } else {
          this.logger.warn(
            `Existing binary ${this.ytDlpBinaryName} is corrupted or incomplete (${stats.size} bytes). Purging and re-downloading...`,
          );
          fs.unlinkSync(this.ytDlpPath);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Could not inspect existing binary: ${msg}`);
      }
    }

    if (needsDownload) {
      this.logger.log(`Downloading standalone ${this.ytDlpBinaryName}...`);
      const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${this.ytDlpBinaryName}`;
      await this.downloadFile(downloadUrl, this.ytDlpPath);
    }

    // Ensure executable permissions on POSIX
    if (process.platform !== 'win32' && fs.existsSync(this.ytDlpPath)) {
      try {
        fs.chmodSync(this.ytDlpPath, 0o755);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`chmod 755 on ${this.ytDlpBinaryName} failed: ${msg}`);
      }
    }

    this.logger.log('yt-dlp binary is verified and ready.');
  }

  downloadFile(url: string, dest: string): Promise<void> {
    const tempDest = `${dest}.download_${Date.now()}`;

    return new Promise((resolve, reject) => {
      let isCompleted = false;

      const follow = (targetUrl: string, redirectCount = 0) => {
        if (redirectCount > 8) {
          return cleanupAndReject(new Error('Too many redirects while downloading binary.'));
        }

        let parsedUrl: URL;
        try {
          parsedUrl = new URL(targetUrl);
        } catch {
          return cleanupAndReject(new Error(`Invalid binary download URL: ${targetUrl}`));
        }

        const client = parsedUrl.protocol === 'http:' ? http : https;

        const req = client.get(
          parsedUrl,
          {
            timeout: this.downloadTimeoutMs,
          },
          (res) => {
            if (
              res.statusCode &&
              res.statusCode >= 300 &&
              res.statusCode < 400 &&
              res.headers.location
            ) {
              res.resume();
              const nextUrl = new URL(res.headers.location, parsedUrl).toString();
              return follow(nextUrl, redirectCount + 1);
            }

            if (res.statusCode !== 200) {
              res.resume();
              return cleanupAndReject(
                new Error(`Failed to download binary: HTTP ${res.statusCode}`),
              );
            }

            const file = fs.createWriteStream(tempDest);
            res.pipe(file);

            file.on('finish', () => {
              file.close(() => {
                if (isCompleted) return;
                try {
                  const stat = fs.statSync(tempDest);
                  if (stat.size < this.minBinarySizeBytes) {
                    throw new Error(
                      `Downloaded binary is too small (${stat.size} bytes). Download may have been truncated.`,
                    );
                  }
                  fs.renameSync(tempDest, dest);
                  isCompleted = true;
                  resolve();
                } catch (err) {
                  cleanupAndReject(err);
                }
              });
            });

            file.on('error', (err) => {
              cleanupAndReject(err);
            });
          },
        );

        req.on('timeout', () => {
          req.destroy(new Error('Binary download timed out.'));
        });

        req.on('error', (err) => {
          cleanupAndReject(err);
        });
      };

      const cleanupAndReject = (err: unknown) => {
        if (isCompleted) return;
        isCompleted = true;
        if (fs.existsSync(tempDest)) {
          try {
            fs.unlinkSync(tempDest);
          } catch {}
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      follow(url);
    });
  }
}
