import { NotFoundException } from '@nestjs/common';
import { MediaService } from '../../src/media/media.service';
import { BinaryService } from '../../src/binary/binary.service';
import { ConcurrencyService } from '../../src/common/concurrency.service';

describe('MediaService', () => {
  let service: MediaService;
  let binaryService: BinaryService;
  let concurrencyService: ConcurrencyService;

  beforeEach(() => {
    binaryService = new BinaryService();
    concurrencyService = new ConcurrencyService();
    service = new MediaService(binaryService, concurrencyService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('should normalize progressive formats into direct stream tokens', () => {
    const rawFormats = [
      {
        format_id: '18',
        vcodec: 'avc1',
        acodec: 'mp4a',
        height: 360,
        url: 'https://cdn.example.com/video_360.mp4',
        filesize: 1024000,
        http_headers: { 'User-Agent': 'CustomUA' },
      },
    ];

    const formats = (service as any).normalizeFormats(
      rawFormats,
      { 'User-Agent': 'DefaultUA' },
      'Test Video',
      'youtube',
    );

    const progressive = formats.find((f: any) => f.formatId === '18');
    expect(progressive).toBeDefined();
    expect(progressive.needsMerge).toBe(false);
    expect(progressive.streamToken).toBeDefined();
    expect(typeof progressive.streamToken).toBe('string');
    expect(progressive.streamToken.length).toBe(32);

    const streamOptions = service.getStreamOptions(progressive.streamToken);
    expect(streamOptions.targetUrl).toBe('https://cdn.example.com/video_360.mp4');
    expect(streamOptions.headers['User-Agent']).toBe('CustomUA');
    expect(streamOptions.filename).toBe('Test Video.mp4');
  });

  it('should throw NotFoundException on non-existent or expired stream token', () => {
    expect(() => service.getStreamOptions('nonexistent_token_1234567890')).toThrow(
      NotFoundException,
    );
  });

  it('should emit and track job progress via getJobStream', (done) => {
    const jobId = 'test-job-progress';
    const stream = service.getJobStream(jobId);

    stream.subscribe({
      next: (progress) => {
        expect(progress.status).toBe('starting');
        expect(progress.percent).toBe(5);
        done();
      },
    });

    (service as any).emitProgress(jobId, { status: 'starting', percent: 5 });
  });
});
