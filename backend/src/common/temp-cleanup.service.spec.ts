import * as fs from 'fs';
import { TempCleanupService } from './temp-cleanup.service';

jest.mock('fs');

describe('TempCleanupService', () => {
  let service: TempCleanupService;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const baseTime = 1_700_000_000_000;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(baseTime);
    jest.clearAllMocks();

    service = new TempCleanupService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  describe('lifecycle (onModuleInit & onModuleDestroy)', () => {
    it('creates the temp directory if missing, runs a startup sweep, and schedules periodic sweeps', () => {
      mockedFs.existsSync.mockReturnValue(false);
      mockedFs.readdirSync.mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>);
      const sweepSpy = jest.spyOn(service, 'sweepStaleFiles');

      service.onModuleInit();

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('temp'),
        { recursive: true },
      );
      expect(sweepSpy).toHaveBeenCalledWith(true);

      // Advance 10 minutes to trigger the interval callback
      mockedFs.existsSync.mockReturnValue(true);
      jest.advanceTimersByTime(10 * 60 * 1000);
      expect(sweepSpy).toHaveBeenCalledWith(false);
    });

    it('clears the interval timer on module destroy', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>);
      const clearSpy = jest.spyOn(global, 'clearInterval');

      service.onModuleInit();
      service.onModuleDestroy();

      expect(clearSpy).toHaveBeenCalled();
    });
  });

  describe('sweepStaleFiles', () => {
    it('returns 0 immediately if the temp directory does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      expect(service.sweepStaleFiles()).toBe(0);
      expect(mockedFs.readdirSync).not.toHaveBeenCalled();
    });

    it('removes all regular files on startup regardless of age while skipping .gitkeep and subdirectories', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue([
        '.gitkeep',
        'subfolder',
        'fresh_video.mp4',
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      mockedFs.statSync.mockImplementation((filePath: fs.PathLike) => {
        const name = String(filePath);
        return {
          isFile: () => !name.endsWith('subfolder'),
          mtimeMs: baseTime - 1000, // Only 1 second old
        } as fs.Stats;
      });

      const removed = service.sweepStaleFiles(true);

      expect(removed).toBe(1);
      expect(mockedFs.unlinkSync).toHaveBeenCalledTimes(1);
      expect(mockedFs.unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('fresh_video.mp4'),
      );
    });

    it('enforces the 15-minute TTL for media files and 5-minute TTL for temp cookie files', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue([
        'stale_video.mp4',       // 16 mins old -> delete
        'active_video.mp4',      // 10 mins old -> keep
        'cookie_stale.txt',      // 6 mins old  -> delete
        'cookie_active.txt',     // 2 mins old  -> keep
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      mockedFs.statSync.mockImplementation((filePath: fs.PathLike) => {
        const name = String(filePath);
        let ageMinutes = 0;
        if (name.endsWith('stale_video.mp4')) ageMinutes = 16;
        if (name.endsWith('active_video.mp4')) ageMinutes = 10;
        if (name.endsWith('cookie_stale.txt')) ageMinutes = 6;
        if (name.endsWith('cookie_active.txt')) ageMinutes = 2;

        return {
          isFile: () => true,
          mtimeMs: baseTime - ageMinutes * 60 * 1000,
        } as fs.Stats;
      });

      const removed = service.sweepStaleFiles(false);

      expect(removed).toBe(2);
      expect(mockedFs.unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('stale_video.mp4'),
      );
      expect(mockedFs.unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('cookie_stale.txt'),
      );
      expect(mockedFs.unlinkSync).not.toHaveBeenCalledWith(
        expect.stringContaining('active_video.mp4'),
      );
      expect(mockedFs.unlinkSync).not.toHaveBeenCalledWith(
        expect.stringContaining('cookie_active.txt'),
      );
    });

    it('continues sweeping if a file is concurrently unlinked by a finished download stream', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue([
        'already_deleted.mp4',
        'stale_audio.mp3',
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      mockedFs.statSync.mockImplementation((filePath: fs.PathLike) => {
        if (String(filePath).endsWith('already_deleted.mp4')) {
          throw new Error('ENOENT: no such file or directory');
        }
        return {
          isFile: () => true,
          mtimeMs: baseTime - 20 * 60 * 1000,
        } as fs.Stats;
      });

      const removed = service.sweepStaleFiles(false);

      expect(removed).toBe(1);
      expect(mockedFs.unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('stale_audio.mp3'),
      );
    });

    it('handles top-level readdirSync errors gracefully without throwing', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      expect(() => service.sweepStaleFiles(false)).not.toThrow();
      expect(service.sweepStaleFiles(false)).toBe(0);
    });
  });
});
