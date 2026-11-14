import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegStatic = require('ffmpeg-static');
const ffmpegPath: string = ffmpegStatic?.default || ffmpegStatic;

@Injectable()
export class BinaryService implements OnModuleInit {
  private readonly logger = new Logger(BinaryService.name);
  private readonly binDir = path.join(process.cwd(), 'bin');

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

    if (!fs.existsSync(this.ytDlpPath)) {
      this.logger.log(`Downloading standalone ${this.ytDlpBinaryName}...`);
      const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${this.ytDlpBinaryName}`;
      await this.downloadFile(downloadUrl, this.ytDlpPath);
      if (process.platform !== 'win32') {
        fs.chmodSync(this.ytDlpPath, 0o755);
      }
      this.logger.log('yt-dlp binary ready.');
    }
  }

  downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const follow = (targetUrl: string) => {
        https
          .get(targetUrl, (res) => {
            if (
              res.statusCode &&
              res.statusCode >= 300 &&
              res.statusCode < 400 &&
              res.headers.location
            ) {
              return follow(res.headers.location);
            }
            if (res.statusCode !== 200) {
              return reject(new Error(`Failed to download binary: HTTP ${res.statusCode}`));
            }
            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
            file.on('error', (err) => {
              fs.unlink(dest, () => {});
              reject(err);
            });
          })
          .on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
          });
      };
      follow(url);
    });
  }
}
