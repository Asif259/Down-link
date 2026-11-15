import { BinaryService } from '../../src/binary/binary.service';
import * as path from 'path';
import * as fs from 'fs';

describe('BinaryService', () => {
  let service: BinaryService;

  beforeEach(() => {
    service = new BinaryService();
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

    await service.onModuleInit();

    expect(downloadSpy).not.toHaveBeenCalled();
    existsSpy.mockRestore();
    statSpy.mockRestore();
    downloadSpy.mockRestore();
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
});
