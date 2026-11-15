import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Param,
  Post,
  Query,
  Req,
  Res,
  Sse,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import * as fs from 'fs';
import { map, Observable } from 'rxjs';
import { DownloadQueryDto, ExtractMediaDto, UpdateBinaryDto, UpdateCookiesDto } from './dto/media.dto';
import { MediaService } from './media.service';
import { StreamProxyService } from './stream-proxy.service';
import { BinaryService } from '../binary/binary.service';
import { ConcurrencyService } from '../common/concurrency.service';

@Controller('api/media')
export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly streamProxyService: StreamProxyService,
    private readonly binaryService: BinaryService,
    private readonly concurrencyService: ConcurrencyService,
  ) {}

  @SkipThrottle()
  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      concurrency: this.concurrencyService.getStatus(),
      ytDlpPath: this.binaryService.ytDlpPath,
      cookies: this.mediaService.getCookieStats(),
      nodeExecPath: process.execPath,
      nodeVersion: process.version,
    };
  }

  @Throttle({ heavy: { limit: 10, ttl: 60000 } })
  @Post('extract')
  async extract(@Body() dto: ExtractMediaDto) {
    return this.mediaService.extractMetadata(dto.url);
  }

  @SkipThrottle() // Bypass rate limiting for admin cookie updates
  @Post('cookies')
  @HttpCode(HttpStatus.OK)
  async updateCookies(@Body() dto: UpdateCookiesDto) {
    return this.mediaService.updateMasterCookies(dto.secret, dto.cookies);
  }

  @SkipThrottle() // Bypass rate limiting for admin binary updates
  @Post('update-binary')
  @HttpCode(HttpStatus.OK)
  async updateBinary(@Body() dto: UpdateBinaryDto) {
    return this.mediaService.updateBinary(dto.secret);
  }

  // Zero-disk Direct CDN Stream Proxy for TikTok, Instagram Reels, and 360p/720p progressive MP4s
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @Get('stream/:token')
  streamDirect(
    @Param('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!/^[a-f0-9]{32}$/.test(token)) {
      throw new BadRequestException('Invalid stream token.');
    }

    const streamOptions = this.mediaService.getStreamOptions(token);
    this.streamProxyService.pipeFromCdn(streamOptions, req, res);
  }

  // Live SSE progress with LiteSpeed non-buffering headers (unthrottled to avoid dropping events)
  @SkipThrottle()
  @Sse('progress/:jobId')
  streamProgress(
    @Param('jobId') jobId: string,
    @Res({ passthrough: true }) res?: Response,
  ): Observable<MessageEvent> {
    if (res && typeof res.setHeader === 'function') {
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Connection', 'keep-alive');
    }

    return this.mediaService
      .getJobStream(jobId)
      .pipe(map((progress) => ({ data: progress } as MessageEvent)));
  }

  // Disk-backed FFmpeg merge & MP3 conversion route for 1080p+ DASH & Audio
  @Throttle({ heavy: { limit: 4, ttl: 60000 } })
  @Get('download')
  async download(
    @Query() query: DownloadQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Abort controller mapped to client disconnect
    const abortController = new AbortController();
    const onClientClose = () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    };
    req.on('close', onClientClose);

    try {
      const { filePath, filename, mimeType } = await this.mediaService.prepareMergedFile(
        query.url,
        query.formatId,
        query.type,
        query.jobId,
        abortController.signal,
      );

      // Client disconnected while merge was running
      if (res.writableEnded || res.destroyed) {
        if (fs.existsSync(filePath)) {
          fs.unlink(filePath, () => {});
        }
        return;
      }

      const stat = fs.statSync(filePath);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', stat.size);

      // Support ASCII fallback and RFC 5987 UTF-8 for international titles
      const asciiName = (filename.replace(/[^\x20-\x7E]/g, '_').trim() || 'media.mp4')
        .replace(/_{2,}/g, '_');
      const encodedName = encodeURIComponent(filename);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
      );

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);

      const cleanup = () => {
        if (fs.existsSync(filePath)) {
          fs.unlink(filePath, () => {});
        }
      };
      res.on('finish', cleanup);
      res.on('close', cleanup);
    } catch (err: unknown) {
      req.off('close', onClientClose);
      throw err;
    }
  }
}
