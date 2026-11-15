import { BinaryService } from '../../src/binary/binary.service';
import * as path from 'path';
import * as fs from 'fs';
import * as childProcess from 'child_process';
import { EventEmitter } from 'events';

describe('BinaryService', () => {
  let service: BinaryService;

  beforeEach(() => {
    service = new BinaryService();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('should resolve correct yt-dlp binary name and path based on platform', () => {
    const ytPath = service.ytDlpPath;
    expect(ytPath).toContain(path.join('bin'));
    if (process.platform === 'win32') {
      expect(ytPath.endsWith('yt-dlp.exe')).toBe(true);
    } else if (process.platform === 'darwin') {
      expect(ytPath.endsWith('yt-dlp_macos')).toBe(true);
    } else {
      expect(ytPath.endsWith('yt-dlp_linux')).toBe(true);
    }
  });

  it('should resolve ffmpeg binary path from ffmpeg-static', () => {
    const ffmpegPath = service.ffmpegBinaryPath;
    expect(ffmpegPath).toBeDefined();
    expect(typeof ffmpegPath).toBe('string');
    expect(ffmpegPath.length).toBeGreaterThan(0);
  });

  it('should skip download if valid binary already exists with non-zero size', async () => {
    const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const statSpy = jest.spyOn(fs, 'statSync').mockReturnValue({ size: 10485760 } as any);
    const downloadSpy = jest.spyOn(service, 'downloadFile').mockResolvedValue();
    const updateSpy = jest.spyOn(service, 'updateYtDlpBinary').mockResolvedValue('yt-dlp is up to date');

    await service.onModuleInit();

    expect(downloadSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalled();

    existsSpy.mockRestore();
    statSpy.mockRestore();
    downloadSpy.mockRestore();
    updateSpy.mockRestore();
  });

  it('should re-download if existing binary has 0 bytes or is corrupted', async () => {
    const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const statSpy = jest.spyOn(fs, 'statSync').mockReturnValue({ size: 0 } as any);
    const unlinkSpy = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    const downloadSpy = jest.spyOn(service, 'downloadFile').mockResolvedValue();

    await service.onModuleInit();

    expect(unlinkSpy).toHaveBeenCalled();
    expect(downloadSpy).toHaveBeenCalled();

    existsSpy.mockRestore();
    statSpy.mockRestore();
    unlinkSpy.mockRestore();
    downloadSpy.mockRestore();
  });

  it('should execute yt-dlp -U and return update summary', async () => {
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();

    jest.spyOn(childProcess, 'spawn').mockReturnValue(mockChild);

    const updatePromise = service.updateYtDlpBinary();

    mockChild.stdout.emit('data', Buffer.from('yt-dlp is up to date (2026.10.26)\n'));
    mockChild.emit('close', 0);

    const result = await updatePromise;
    expect(result).toBe('yt-dlp is up to date (2026.10.26)');

    (childProcess.spawn as jest.Mock).mockRestore();
  });
});
