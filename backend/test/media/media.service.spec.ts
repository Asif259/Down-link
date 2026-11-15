import { NotFoundException } from '@nestjs/common';
import { MediaService } from '../../src/media/media.service';
import { BinaryService } from '../../src/binary/binary.service';
import { ConcurrencyService } from '../../src/common/concurrency.service';
import * as fs from 'fs';
import * as path from 'path';

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

  it('should sanitize titles with non-ASCII or non-filename characters', () => {
    const cleaned = (service as any).sanitizeFilename('Awesome Video: Episode 1? [4K]', 'mp4');
    expect(cleaned).toBe('Awesome Video Episode 1 [4K].mp4');

    const emptyFallback = (service as any).sanitizeFilename('???///:::', 'mp3');
    expect(emptyFallback).toBe('media.mp3');
  });

  it('should clean stale temp files on init without throwing', async () => {
    const tempDir = (service as any).tempDir;
    const testStaleFile = path.join(tempDir, `stale_test_${Date.now()}.part`);
    fs.writeFileSync(testStaleFile, 'test');
    expect(fs.existsSync(testStaleFile)).toBe(true);

    await new Promise((r) => setTimeout(r, 15));
    service.cleanStaleTempFiles(10); // 10ms threshold: clean immediately
    expect(fs.existsSync(testStaleFile)).toBe(false);
  });

  it('should create and clean ephemeral cookie copies when master cookie exists', () => {
    const cookiesDir = (service as any).cookiesDir;
    const masterCookie = path.join(cookiesDir, 'youtube.txt');
    fs.writeFileSync(masterCookie, '# Netscape HTTP Cookie File\n.youtube.com TRUE / FALSE 1999999999 SID test');

    const tempCookie = service.createTempCookieFile('youtube');
    expect(tempCookie).toBeDefined();
    expect(typeof tempCookie).toBe('string');
    expect(fs.existsSync(tempCookie!)).toBe(true);

    service.removeTempCookieFile(tempCookie);
    expect(fs.existsSync(tempCookie!)).toBe(false);

    // Clean master test file
    fs.unlinkSync(masterCookie);
  });

  it('should return null when no cookie file exists for platform or global', () => {
    const tempCookie = service.createTempCookieFile('unknown');
    expect(tempCookie).toBeNull();
  });

  it('should decode COOKIES_BASE64 env variable into cookies/cookies.txt', () => {
    const originalEnv = process.env.COOKIES_BASE64;
    const dummyCookie = '# Netscape Cookie\n.example.com TRUE / FALSE 2000000000 TEST value';
    process.env.COOKIES_BASE64 = Buffer.from(dummyCookie, 'utf-8').toString('base64');

    service.initCookiesDirectory();

    const targetFile = path.join((service as any).cookiesDir, 'cookies.txt');
    expect(fs.existsSync(targetFile)).toBe(true);
    expect(fs.readFileSync(targetFile, 'utf-8')).toBe(dummyCookie);

    // Cleanup
    fs.unlinkSync(targetFile);
    process.env.COOKIES_BASE64 = originalEnv;
  });
});
