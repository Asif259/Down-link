import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  MessageEvent,
  Param,
  Post,
  Query,
  Req,
  Res,
  Sse,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as fs from 'fs';
import { map, Observable } from 'rxjs';
import { DownloadQueryDto, ExtractMediaDto } from './dto/media.dto';
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

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      concurrency: this.concurrencyService.getStatus(),
      ytDlpPath: this.binaryService.ytDlpPath,
    };
  }

  @Post('extract')
  async extract(@Body() dto: ExtractMediaDto) {
    return this.mediaService.extractMetadata(dto.url);
  }

  // Zero-disk Direct CDN Stream Proxy for TikTok, Instagram Reels, and 360p/720p progressive MP4s
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

  // Live SSE progress with LiteSpeed non-buffering headers
  @Sse('progress/:jobId')
  @Header('Cache-Control', 'no-cache')
  @Header('X-Accel-Buffering', 'no')
  streamProgress(@Param('jobId') jobId: string): Observable<MessageEvent> {
    return this.mediaService
      .getJobStream(jobId)
      .pipe(map((progress) => ({ data: progress } as MessageEvent)));
  }

  // Disk-backed FFmpeg merge & MP3 conversion route for 1080p+ DASH & Audio
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
