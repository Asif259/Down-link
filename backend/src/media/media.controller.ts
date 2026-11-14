import {
  BadRequestException,
  Body,
  Controller,
  Get,
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

@Controller('api/media')
export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly streamProxyService: StreamProxyService,
  ) {}

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

  @Sse('progress/:jobId')
  streamProgress(@Param('jobId') jobId: string): Observable<MessageEvent> {
    return this.mediaService
      .getJobStream(jobId)
      .pipe(map((progress) => ({ data: progress } as MessageEvent)));
  }

  // Disk-backed FFmpeg merge & MP3 conversion route for 1080p+ DASH & Audio
  @Get('download')
  async download(@Query() query: DownloadQueryDto, @Res() res: Response) {
    const { filePath, filename, mimeType } = await this.mediaService.prepareMergedFile(
      query.url,
      query.formatId,
      query.type,
      query.jobId,
    );

    const stat = fs.statSync(filePath);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);

    const cleanup = () => {
      fs.unlink(filePath, () => {});
    };
    res.on('finish', cleanup);
    res.on('close', cleanup);
  }
}
