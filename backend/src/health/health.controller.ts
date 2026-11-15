import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import * as fs from 'fs';
import { BinaryService } from '../binary/binary.service';

export interface HealthCheckResponse {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  binaries: {
    ytDlp: boolean;
    ffmpeg: boolean;
  };
}

@SkipThrottle()
@Controller('api/health')
export class HealthController {
  constructor(private readonly binaryService: BinaryService) {}

  @Get()
  checkHealth(): HealthCheckResponse {
    const ytDlpReady = fs.existsSync(this.binaryService.ytDlpPath);

    let ffmpegReady = false;
    try {
      ffmpegReady = fs.existsSync(this.binaryService.ffmpegBinaryPath);
    } catch {
      ffmpegReady = false;
    }

    const isHealthy = ytDlpReady && ffmpegReady;
    const payload: HealthCheckResponse = {
      status: isHealthy ? 'ok' : 'degraded',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      binaries: {
        ytDlp: ytDlpReady,
        ffmpeg: ffmpegReady,
      },
    };

    if (!isHealthy) {
      throw new ServiceUnavailableException(payload);
    }

    return payload;
  }
}
