import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { of } from 'rxjs';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { BinaryService } from '../src/binary/binary.service';
import { TempCleanupService } from '../src/common/temp-cleanup.service';
import { JobProgress, MediaInfoResponse, MediaService } from '../src/media/media.service';

describe('MediaController (e2e)', () => {
  let app: NestExpressApplication;
  let mediaService: MediaService;
  let upstreamServer: http.Server;
  let upstreamBaseUrl: string;

  const mockMetadata: MediaInfoResponse = {
    platform: 'youtube',
    title: 'Test Video 🚀',
    thumbnail: 'https://i.ytimg.com/vi/test/maxresdefault.jpg',
    duration: 125,
    uploader: 'Test Channel',
    formats: [
      {
        formatId: '18',
        label: '360p MP4 (Instant Stream)',
        ext: 'mp4',
        type: 'video',
        resolution: '360p',
        filesizeApprox: 5242880,
        needsMerge: false,
        streamToken: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      },
      {
        formatId: '137+bestaudio[ext=m4a]/best',
        label: '1080p HD MP4',
        ext: 'mp4',
        type: 'video',
        resolution: '1080p',
        filesizeApprox: 25165824,
        needsMerge: true,
      },
      {
        formatId: 'bestaudio',
        label: 'MP3 Audio (High Quality)',
        ext: 'mp3',
        type: 'audio',
        needsMerge: true,
      },
    ],
  };

  beforeAll(async () => {
    // 1. Start a lightweight local HTTP server to simulate an upstream social media CDN
    upstreamServer = http.createServer((req, res) => {
      if (req.url === '/cdn-video.mp4') {
        const payload = Buffer.from('FAKE_MP4_STREAM_BYTES_0123456789');

        // Verify Range header forwarding
        if (req.headers.range === 'bytes=0-15') {
          res.writeHead(206, {
            'Content-Type': 'video/mp4',
            'Content-Length': '16',
            'Content-Range': `bytes 0-15/${payload.length}`,
            'Accept-Ranges': 'bytes',
          });
          res.end(payload.subarray(0, 16));
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': String(payload.length),
          'Accept-Ranges': 'bytes',
        });
        res.end(payload);
        return;
      }

      res.writeHead(403);
      res.end('Forbidden');
    });

    await new Promise<void>((resolve) => upstreamServer.listen(0, '127.0.0.1', resolve));
    const port = (upstreamServer.address() as AddressInfo).port;
    upstreamBaseUrl = `http://127.0.0.1:${port}`;

    // 2. Boot NestJS AppModule while disabling startup binary downloads and background timers
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BinaryService)
      .useValue({
        ytDlpPath: '/mock/bin/yt-dlp',
        ffmpegBinaryPath: '/mock/bin/ffmpeg',
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
      })
      .overrideProvider(TempCleanupService)
      .useValue({
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
        sweepStaleFiles: jest.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.set('trust proxy', 1);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );

    await app.init();
    mediaService = app.get<MediaService>(MediaService);
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('POST /api/media/extract', () => {
    it('returns 201 and normalized metadata for a valid platform URL', async () => {
      jest.spyOn(mediaService, 'extractMetadata').mockResolvedValue(mockMetadata);

      const res = await request(app.getHttpServer())
        .post('/api/media/extract')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
        .expect(201);

      expect(res.body.platform).toBe('youtube');
      expect(res.body.formats).toHaveLength(3);
      expect(res.body.formats[0].streamToken).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f90');
    });

    it('returns 400 when URL is missing or lacks http/https protocol', async () => {
      await request(app.getHttpServer())
        .post('/api/media/extract')
        .set('X-Forwarded-For', '203.0.113.11')
        .send({ url: 'not-a-valid-url' })
        .expect(400);
    });

    it('returns 400 for an unsupported website domain', async () => {
      await request(app.getHttpServer())
        .post('/api/media/extract')
        .set('X-Forwarded-For', '203.0.113.12')
        .send({ url: 'https://example.com/some-video' })
        .expect(400);
    });
  });

  describe('GET /api/media/stream/:token', () => {
    const validHexToken = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

    it('returns 400 when the token is not a 32-character lowercase hex string', async () => {
      await request(app.getHttpServer())
        .get('/api/media/stream/invalid-token-format!')
        .set('X-Forwarded-For', '203.0.113.20')
        .expect(400);
    });

    it('returns 404 when the token does not exist in cache', async () => {
      await request(app.getHttpServer())
        .get(`/api/media/stream/${validHexToken}`)
        .set('X-Forwarded-For', '203.0.113.21')
        .expect(404);
    });

    it('pipes upstream CDN bytes directly with UTF-8 Content-Disposition headers', async () => {
      jest.spyOn(mediaService, 'getStreamOptions').mockReturnValue({
        targetUrl: `${upstreamBaseUrl}/cdn-video.mp4`,
        headers: { 'User-Agent': 'CustomExtractor/1.0' },
        filename: 'Test Video 🚀.mp4',
        mimeType: 'video/mp4',
      });

      const res = await request(app.getHttpServer())
        .get(`/api/media/stream/${validHexToken}`)
        .set('X-Forwarded-For', '203.0.113.22')
        .expect(200);

      expect(res.headers['content-type']).toContain('video/mp4');
      expect(res.headers['content-disposition']).toContain(
        "filename*=UTF-8''Test%20Video%20%F0%9F%9A%80.mp4",
      );
      expect(res.body.toString()).toBe('FAKE_MP4_STREAM_BYTES_0123456789');
    });

    it('forwards Range headers and returns 206 Partial Content for pause/resume support', async () => {
      jest.spyOn(mediaService, 'getStreamOptions').mockReturnValue({
        targetUrl: `${upstreamBaseUrl}/cdn-video.mp4`,
        headers: {},
        filename: 'clip.mp4',
        mimeType: 'video/mp4',
      });

      const res = await request(app.getHttpServer())
        .get(`/api/media/stream/${validHexToken}`)
        .set('X-Forwarded-For', '203.0.113.23')
        .set('Range', 'bytes=0-15')
        .expect(206);

      expect(res.headers['content-range']).toBe('bytes 0-15/32');
      expect(res.body.toString()).toBe('FAKE_MP4_STREAM_');
    });
  });

  describe('GET /api/media/progress/:jobId (SSE)', () => {
    it('sets LiteSpeed anti-buffering headers and streams SSE progress events', async () => {
      jest.spyOn(mediaService, 'getJobStream').mockReturnValue(
        of(
          { status: 'downloading' as const, percent: 45 },
          { status: 'merging' as const, percent: 92 },
          { status: 'ready' as const, percent: 100 },
        ),
      );

      const res = await request(app.getHttpServer())
        .get('/api/media/progress/job_test_123')
        .set('X-Forwarded-For', '203.0.113.30')
        .expect(200);

      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.headers['x-accel-buffering']).toBe('no');
      expect(res.headers['cache-control']).toContain('no-cache');
      expect(res.headers['cache-control']).toContain('no-transform');
      expect(res.text).toContain('data: {"status":"downloading","percent":45}');
      expect(res.text).toContain('data: {"status":"ready","percent":100}');
    });
  });

  describe('GET /api/media/download', () => {
    it('rejects CLI flag injection attempts in formatId with 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .get('/api/media/download')
        .set('X-Forwarded-For', '203.0.113.40')
        .query({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          formatId: 'best;--exec=whoami',
          type: 'video',
        })
        .expect(400);
    });

    it('streams the merged file and automatically unlinks it from disk on completion', async () => {
      const dummyFilePath = path.join(os.tmpdir(), `e2e_merged_${Date.now()}.mp3`);
      fs.writeFileSync(dummyFilePath, 'FAKE_MP3_AUDIO_CONTENT');

      jest.spyOn(mediaService, 'prepareMergedFile').mockResolvedValue({
        filePath: dummyFilePath,
        filename: 'media_test.mp3',
        mimeType: 'audio/mpeg',
      });

      const res = await request(app.getHttpServer())
        .get('/api/media/download')
        .set('X-Forwarded-For', '203.0.113.41')
        .query({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          formatId: 'bestaudio',
          type: 'audio',
          jobId: 'job_audio_1',
        })
        .expect(200);

      expect(res.headers['content-type']).toContain('audio/mpeg');
      expect(res.headers['content-disposition']).toContain('filename="media_test.mp3"');
      expect(res.body.toString()).toBe('FAKE_MP3_AUDIO_CONTENT');

      // Wait briefly for the res.on('finish') callback to unlink the file
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(fs.existsSync(dummyFilePath)).toBe(false);
    });
  });

  describe('Rate Limiting (ProxyThrottlerGuard)', () => {
    it('returns 429 Too Many Requests when a single client IP exceeds the heavy download limit', async () => {
      const abusiveClientIp = '198.51.100.77';

      // Trigger 4 validation-failing requests (still counted by ThrottlerGuard before controller/pipe)
      for (let i = 0; i < 4; i++) {
        await request(app.getHttpServer())
          .get('/api/media/download')
          .set('X-Forwarded-For', abusiveClientIp)
          .query({
            url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            formatId: 'invalid;id',
            type: 'video',
          })
          .expect(400);
      }

      // 5th request within 60s from the same X-Forwarded-For IP must be throttled with 429
      await request(app.getHttpServer())
        .get('/api/media/download')
        .set('X-Forwarded-For', abusiveClientIp)
        .query({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          formatId: 'invalid;id',
          type: 'video',
        })
        .expect(429);

      // Verify a different visitor IP behind the proxy is completely unaffected
      await request(app.getHttpServer())
        .get('/api/media/download')
        .set('X-Forwarded-For', '198.51.100.88')
        .query({
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          formatId: 'invalid;id',
          type: 'video',
        })
        .expect(400);
    });
  });
});
