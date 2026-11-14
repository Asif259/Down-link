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

  it('should skip download if binary already exists', async () => {
    const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const downloadSpy = jest.spyOn(service, 'downloadFile').mockResolvedValue();

    await service.onModuleInit();

    expect(downloadSpy).not.toHaveBeenCalled();
    existsSpy.mockRestore();
    downloadSpy.mockRestore();
  });
});
