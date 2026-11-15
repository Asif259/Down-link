import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegStatic = require('ffmpeg-static');
const ffmpegPath: string = ffmpegStatic?.default || ffmpegStatic;

@Injectable()
export class BinaryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BinaryService.name);
  private readonly binDir = path.join(process.cwd(), 'bin');
  private readonly runtimeTempDir = path.join(process.cwd(), 'temp');
  private readonly minBinarySizeBytes = 1024 * 1024; // 1MB minimum valid executable size
  private readonly downloadTimeoutMs = 60000; // 60s timeout for binary download
  private updateTimer?: NodeJS.Timeout;

  get spawnEnv(): NodeJS.ProcessEnv {
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const nodeDir = path.dirname(process.execPath);
    const currentPath = process.env.PATH || '/usr/local/bin:/usr/bin:/bin';
    const updatedPath = currentPath.includes(nodeDir)
      ? currentPath
      : `${nodeDir}:${currentPath}`;

    return {
      ...process.env,
      PATH: updatedPath,
      TMPDIR: tempDir,
      TEMP: tempDir,
      TMP: tempDir,
      NODE_NO_WARNINGS: '1',
      NODE_OPTIONS: '--no-warnings',
    };
  }

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
    if (!fs.existsSync(this.runtimeTempDir)) {
      fs.mkdirSync(this.runtimeTempDir, { recursive: true });
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
    } else {
      // Check for updates quietly in background on startup without blocking boot
      this.updateYtDlpBinary().catch((err) =>
        this.logger.warn(`Startup yt-dlp update check failed: ${err.message}`),
      );
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

    // Run auto-update every 24 hours
    this.updateTimer = setInterval(() => {
      this.updateYtDlpBinary().catch((err) =>
        this.logger.warn(`Scheduled yt-dlp update failed: ${err.message}`),
      );
    }, 24 * 60 * 60 * 1000);
    this.updateTimer.unref();

    this.logger.log('yt-dlp binary is verified and ready.');
  }

  onModuleDestroy(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }
  }

  async updateYtDlpBinary(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.logger.log('Checking for yt-dlp updates (-U)...');
      const child = spawn(this.ytDlpPath, ['-U'], { shell: false, env: this.spawnEnv });
      let output = '';

      child.stdout.on('data', (chunk) => (output += chunk.toString()));
      child.stderr.on('data', (chunk) => (output += chunk.toString()));

      child.on('close', (code) => {
        if (code === 0) {
          const summary = output.trim().split('\n').pop() || 'Update check complete.';
          this.logger.log(`yt-dlp update status: ${summary}`);
          resolve(summary);
        } else {
          this.logger.warn(`yt-dlp -U exited with code ${code}: ${output.trim().slice(0, 200)}`);
          reject(new Error(`yt-dlp -U exited with code ${code}: ${output}`));
        }
      });

      child.on('error', (err) => {
        this.logger.warn(`Failed to execute yt-dlp -U: ${err.message}`);
        reject(err);
      });
    });
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
