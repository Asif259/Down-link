import { BadRequestException } from '@nestjs/common';
import { MediaController } from '../../src/media/media.controller';
import { MediaService } from '../../src/media/media.service';
import { StreamProxyService } from '../../src/media/stream-proxy.service';
import { BinaryService } from '../../src/binary/binary.service';
import { ConcurrencyService } from '../../src/common/concurrency.service';
import { of } from 'rxjs';

describe('MediaController', () => {
  let controller: MediaController;
  let mediaService: Partial<MediaService>;
  let streamProxyService: Partial<StreamProxyService>;
  let binaryService: Partial<BinaryService>;
  let concurrencyService: Partial<ConcurrencyService>;

  beforeEach(() => {
    mediaService = {
      extractMetadata: jest.fn().mockResolvedValue({
        platform: 'youtube',
        title: 'Sample Video',
        thumbnail: '',
        duration: 120,
        uploader: 'TestChannel',
        formats: [],
      }),
      getStreamOptions: jest.fn().mockReturnValue({
        targetUrl: 'https://cdn.example.com/video.mp4',
        headers: {},
        filename: 'video.mp4',
        mimeType: 'video/mp4',
      }),
      getJobStream: jest.fn().mockReturnValue(of({ status: 'downloading', percent: 50 })),
      prepareMergedFile: jest.fn(),
    };

    streamProxyService = {
      pipeFromCdn: jest.fn(),
    };

    binaryService = {
      ytDlpPath: '/mock/bin/yt-dlp',
    };

    concurrencyService = {
      getStatus: jest.fn().mockReturnValue({
        activeCount: 1,
        queueLength: 0,
        maxConcurrent: 3,
        maxQueueLength: 20,
      }),
    };

    controller = new MediaController(
      mediaService as MediaService,
      streamProxyService as StreamProxyService,
      binaryService as BinaryService,
      concurrencyService as ConcurrencyService,
    );
  });

  it('should delegate extract requests to MediaService', async () => {
    const result = await controller.extract({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
    expect(result.title).toBe('Sample Video');
    expect(mediaService.extractMetadata).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
  });

  it('should return health status and system telemetry', () => {
    const health = controller.getHealth();
    expect(health.status).toBe('ok');
    expect(health.concurrency.maxConcurrent).toBe(3);
    expect(health.ytDlpPath).toBe('/mock/bin/yt-dlp');
  });

  it('should reject invalid hex tokens on streamDirect', () => {
    expect(() =>
      controller.streamDirect('invalid-token', {} as any, {} as any),
    ).toThrow(BadRequestException);
  });

  it('should pipe valid 32-char hex token through StreamProxyService', () => {
    const validToken = 'a'.repeat(32);
    const req = {} as any;
    const res = {} as any;

    controller.streamDirect(validToken, req, res);
    expect(mediaService.getStreamOptions).toHaveBeenCalledWith(validToken);
    expect(streamProxyService.pipeFromCdn).toHaveBeenCalled();
  });

  it('should stream SSE progress messages', (done) => {
    controller.streamProgress('job-123').subscribe((event) => {
      expect((event as any).data).toEqual({ status: 'downloading', percent: 50 });
      done();
    });
  });
});
