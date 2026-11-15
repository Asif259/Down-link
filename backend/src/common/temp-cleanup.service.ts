import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class TempCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TempCleanupService.name);
  private readonly tempDir = path.join(process.cwd(), 'temp');
  private sweepTimer?: NodeJS.Timeout;

  // Delete media fragments older than 15 minutes and temp cookies older than 5 minutes
  private readonly maxMediaAgeMs = 15 * 60 * 1000;
  private readonly maxCookieAgeMs = 5 * 60 * 1000;
  private readonly sweepIntervalMs = 10 * 60 * 1000;

  onModuleInit(): void {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    // Immediate startup sweep to clear orphans from any prior restart
    this.sweepStaleFiles(true);

    this.sweepTimer = setInterval(() => {
      this.sweepStaleFiles(false);
    }, this.sweepIntervalMs);
    this.sweepTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
  }

  sweepStaleFiles(isStartup = false): number {
    if (!fs.existsSync(this.tempDir)) return 0;

    const now = Date.now();
    let removedCount = 0;

    try {
      const files = fs.readdirSync(this.tempDir);

      for (const file of files) {
        if (file === '.gitkeep' || file === '.cache') continue;

        const fullPath = path.join(this.tempDir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (!stat.isFile()) {
            if (file.startsWith('_MEI')) {
              const ageMs = now - stat.mtimeMs;
              if (isStartup || ageMs > this.maxMediaAgeMs) {
                fs.rmSync(fullPath, { recursive: true, force: true });
                removedCount++;
              }
            }
            continue;
          }

          const ageMs = now - stat.mtimeMs;
          const isTempCookie = file.startsWith('cookie_') && file.endsWith('.txt');
          const threshold = isTempCookie ? this.maxCookieAgeMs : this.maxMediaAgeMs;

          if (isStartup || ageMs > threshold) {
            fs.unlinkSync(fullPath);
            removedCount++;
          }
        } catch {
          // Ignore files that were just unlinked by an active download stream
        }
      }

      if (removedCount > 0) {
        this.logger.log(`Swept ${removedCount} stale temporary file(s) from disk.`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(`Temp directory sweep error: ${msg}`);
    }

    return removedCount;
  }
}
