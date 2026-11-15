import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MediaService } from '../../src/media/media.service';
import { BinaryService } from '../../src/binary/binary.service';
import { ConcurrencyService } from '../../src/common/concurrency.service';
import * as childProcess from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

describe('MediaService', () => {
  let service: MediaService;
  let binaryService: BinaryService;
  let concurrencyService: ConcurrencyService;

  beforeEach(() => {
    delete process.env.COOKIES_BASE64;
    const cookiesDir = path.join(process.cwd(), 'cookies');
    const globalCookie = path.join(cookiesDir, 'cookies.txt');
    if (fs.existsSync(globalCookie)) {
      try { fs.unlinkSync(globalCookie); } catch {}
    }
    const ytCookie = path.join(cookiesDir, 'youtube.txt');
    if (fs.existsSync(ytCookie)) {
      try { fs.unlinkSync(ytCookie); } catch {}
    }
    binaryService = new BinaryService();
    concurrencyService = new ConcurrencyService();
    service = new MediaService(binaryService, concurrencyService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    delete process.env.COOKIES_BASE64;
    const cookiesDir = path.join(process.cwd(), 'cookies');
    const globalCookie = path.join(cookiesDir, 'cookies.txt');
    if (fs.existsSync(globalCookie)) {
      try { fs.unlinkSync(globalCookie); } catch {}
    }
    const ytCookie = path.join(cookiesDir, 'youtube.txt');
    if (fs.existsSync(ytCookie)) {
      try { fs.unlinkSync(ytCookie); } catch {}
    }
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
    const cookiesDir = (service as any).cookiesDir;
    const globalCookie = path.join(cookiesDir, 'cookies.txt');
    if (fs.existsSync(globalCookie)) {
      fs.unlinkSync(globalCookie);
    }
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
    if (originalEnv === undefined) {
      delete process.env.COOKIES_BASE64;
    } else {
      process.env.COOKIES_BASE64 = originalEnv;
    }
  });

  describe('updateMasterCookies', () => {
    const validSecret = 'test_admin_secret_123';
    const originalSecret = process.env.ADMIN_COOKIE_SECRET;

    beforeEach(() => {
      process.env.ADMIN_COOKIE_SECRET = validSecret;
    });

    afterEach(() => {
      if (originalSecret === undefined) {
        delete process.env.ADMIN_COOKIE_SECRET;
      } else {
        process.env.ADMIN_COOKIE_SECRET = originalSecret;
      }
    });

    it('throws ForbiddenException when ADMIN_COOKIE_SECRET is not configured', async () => {
      delete process.env.ADMIN_COOKIE_SECRET;
      await expect(
        service.updateMasterCookies(validSecret, 'some_cookie_data'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when secret does not match', async () => {
      await expect(
        service.updateMasterCookies('wrong_secret', 'some_cookie_data'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('writes raw Netscape cookie content and returns success', async () => {
      const rawCookies = '# Netscape HTTP Cookie File\n.youtube.com TRUE / FALSE 2000000000 SID abc123xyz';
      const result = await service.updateMasterCookies(validSecret, rawCookies);

      expect(result.success).toBe(true);
      expect(result.bytesWritten).toBe(Buffer.byteLength(rawCookies, 'utf8'));

      const targetPath = path.join((service as any).cookiesDir, 'cookies.txt');
      expect(fs.existsSync(targetPath)).toBe(true);
      expect(fs.readFileSync(targetPath, 'utf8')).toBe(rawCookies);
    });

    it('decodes base64-encoded Netscape cookie content before saving', async () => {
      const rawCookies = '# Netscape HTTP Cookie File\n.youtube.com TRUE / FALSE 2000000000 SID base64test';
      const base64Data = Buffer.from(rawCookies, 'utf8').toString('base64');

      const result = await service.updateMasterCookies(validSecret, base64Data);

      expect(result.success).toBe(true);
      expect(result.bytesWritten).toBe(Buffer.byteLength(rawCookies, 'utf8'));

      const targetPath = path.join((service as any).cookiesDir, 'cookies.txt');
      expect(fs.existsSync(targetPath)).toBe(true);
      expect(fs.readFileSync(targetPath, 'utf8')).toBe(rawCookies);
    });
  });

  describe('updateBinary', () => {
    const validSecret = 'test_admin_secret_123';
    const originalSecret = process.env.ADMIN_COOKIE_SECRET;

    beforeEach(() => {
      process.env.ADMIN_COOKIE_SECRET = validSecret;
    });

    afterEach(() => {
      if (originalSecret === undefined) {
        delete process.env.ADMIN_COOKIE_SECRET;
      } else {
        process.env.ADMIN_COOKIE_SECRET = originalSecret;
      }
    });

    it('throws ForbiddenException when secret does not match', async () => {
      await expect(service.updateBinary('wrong_secret')).rejects.toThrow(ForbiddenException);
    });

    it('delegates to binaryService.updateYtDlpBinary when secret is valid', async () => {
      jest.spyOn(binaryService, 'updateYtDlpBinary').mockResolvedValue('yt-dlp is up to date (2026.10.26)');
      const res = await service.updateBinary(validSecret);
      expect(res.success).toBe(true);
      expect(res.message).toBe('yt-dlp is up to date (2026.10.26)');
    });
  });

  describe('formatYtDlpError', () => {
    it('returns unavailable format warning when requested format is not available', () => {
      const msg = (service as any).formatYtDlpError(
        'ERROR: [youtube] 12345: Requested format is not available. Use --list-formats for a list of available formats',
      );
      expect(msg).toContain('The requested format is not available');
    });

    it('returns YouTube challenge warning when page needs to be reloaded or unplayable', () => {
      const msg = (service as any).formatYtDlpError('ERROR: [youtube] dQw4w9WgXcQ: The page needs to be reloaded.');
      expect(msg).toContain('YouTube challenged the request format for this server IP');
    });

    it('returns YouTube bot warning when stderr indicates bot challenge or sign in', () => {
      const msg = (service as any).formatYtDlpError('Sign in to confirm you’re not a bot');
      expect(msg).toContain('YouTube blocked the server IP');
    });

    it('returns authentication warning when login is required or rate limit reached', () => {
      const msg = (service as any).formatYtDlpError('ERROR: Login required to access this post');
      expect(msg).toContain('This platform requires authentication');
    });

    it('returns noexec warning when failed to map segment or permission denied', () => {
      const msg = (service as any).formatYtDlpError('dlopen: failed to map segment from shared object');
      expect(msg).toBe('Server binary execution restricted (TMPDIR noexec).');

      const msg2 = (service as any).formatYtDlpError('/tmp/_MEI123456/yt-dlp: Permission denied');
      expect(msg2).toBe('Server binary execution restricted (TMPDIR noexec).');
    });

    it('extracts and formats error detail from ERROR: line', () => {
      const stderr = 'Some debug output\nERROR: [youtube] 12345: Video unavailable\nMore output';
      const msg = (service as any).formatYtDlpError(stderr);
      expect(msg).toBe('Video unavailable');
    });

    it('returns generic fallback when stderr does not match known patterns', () => {
      const msg = (service as any).formatYtDlpError('Unexpected EOF');
      expect(msg).toBe('Could not fetch media details. The post may be private or removed.');
    });
  });

  describe('getYoutubeExtractorArgs', () => {
    it('returns web-embedded and mobile clients when hasCookies is true', () => {
      const args = (service as any).getYoutubeExtractorArgs(true);
      expect(args).toEqual([
        '--extractor-args',
        'youtube:player_client=mweb,web_embedded,android,web',
      ]);
    });

    it('returns web-embedded and mobile clients without webpage skip when hasCookies is false', () => {
      const args = (service as any).getYoutubeExtractorArgs(false);
      expect(args).toEqual([
        '--extractor-args',
        'youtube:player_client=mweb,web_embedded,android',
      ]);
    });
  });

  describe('extractMetadata & prepareMergedFile spawn options', () => {
    it('spawns yt-dlp with force-ipv4, cache-dir, anti-bot extractor-args for youtube, and spawnEnv without cookies', async () => {
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();

      const spawnSpy = jest.spyOn(childProcess, 'spawn').mockReturnValue(mockChild);

      const extractPromise = service.extractMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

      expect(spawnSpy).toHaveBeenCalledWith(
        binaryService.ytDlpPath,
        expect.arrayContaining([
          '--dump-single-json',
          '--force-ipv4',
          '--cache-dir',
          path.join(process.cwd(), 'temp', '.cache'),
          '--no-check-certificates',
          '--geo-bypass',
          '--extractor-args',
          'youtube:player_client=mweb,web_embedded,android',
          'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        ]),
        {
          shell: false,
          env: binaryService.spawnEnv,
        },
      );

      const dummyMetadata = {
        title: 'Rick Astley',
        duration: 213,
        uploader: 'RickAstleyVEVO',
        formats: [],
      };

      mockChild.stdout.emit('data', Buffer.from(JSON.stringify(dummyMetadata)));
      mockChild.emit('close', 0);

      const result = await extractPromise;
      expect(result.title).toBe('Rick Astley');
      expect(result.platform).toBe('youtube');

      spawnSpy.mockRestore();
    });

    it('spawns yt-dlp with android/web player client when cookies exist', async () => {
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();

      const cookiesDir = (service as any).cookiesDir;
      const masterCookie = path.join(cookiesDir, 'cookies.txt');
      fs.writeFileSync(masterCookie, '# Netscape HTTP Cookie File\n.youtube.com TRUE / FALSE 1999999999 SID test');

      const spawnSpy = jest.spyOn(childProcess, 'spawn').mockReturnValue(mockChild);

      const extractPromise = service.extractMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

      expect(spawnSpy).toHaveBeenCalledWith(
        binaryService.ytDlpPath,
        expect.arrayContaining([
          '--force-ipv4',
          '--extractor-args',
          'youtube:player_client=mweb,web_embedded,android,web',
          '--cookies',
        ]),
        expect.anything(),
      );

      const dummyMetadata = {
        title: 'Rick Astley',
        duration: 213,
        uploader: 'RickAstleyVEVO',
        formats: [],
      };

      mockChild.stdout.emit('data', Buffer.from(JSON.stringify(dummyMetadata)));
      mockChild.emit('close', 0);

      await extractPromise;

      if (fs.existsSync(masterCookie)) {
        fs.unlinkSync(masterCookie);
      }
      spawnSpy.mockRestore();
    });

    it('rejects with formatted error message when extraction exits with non-zero code', async () => {
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();

      const spawnSpy = jest.spyOn(childProcess, 'spawn').mockReturnValue(mockChild);

      const extractPromise = service.extractMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

      mockChild.stderr.emit('data', Buffer.from('ERROR: [youtube] dQw4w9WgXcQ: Private video\n'));
      mockChild.emit('close', 1);

      await expect(extractPromise).rejects.toThrow('Private video');

      spawnSpy.mockRestore();
    });

    it('spawns yt-dlp with cache-dir, geo-bypass, and spawnEnv in prepareMergedFile', async () => {
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();

      const spawnSpy = jest.spyOn(childProcess, 'spawn').mockReturnValue(mockChild);

      const mergePromise = service.prepareMergedFile(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        '18',
        'video',
        'test_merge_job_1',
      );

      expect(spawnSpy).toHaveBeenCalledWith(
        binaryService.ytDlpPath,
        expect.arrayContaining([
          '--ffmpeg-location',
          binaryService.ffmpegBinaryPath,
          '--force-ipv4',
          '--cache-dir',
          path.join(process.cwd(), 'temp', '.cache'),
          '--no-check-certificates',
          '--geo-bypass',
          '--extractor-args',
          'youtube:player_client=mweb,web_embedded,android',
          '--merge-output-format',
          'mp4',
        ]),
        {
          shell: false,
          env: binaryService.spawnEnv,
        },
      );

      // Create dummy output file so fs.existsSync passes
      const finalExpectedPath = path.join(process.cwd(), 'temp', 'test_merge_job_1.mp4');
      fs.writeFileSync(finalExpectedPath, 'dummy video content');

      mockChild.emit('close', 0);

      const result = await mergePromise;
      expect(result.filePath).toBe(finalExpectedPath);
      expect(result.mimeType).toBe('video/mp4');

      if (fs.existsSync(finalExpectedPath)) {
        fs.unlinkSync(finalExpectedPath);
      }
      spawnSpy.mockRestore();
    });
  });
});
