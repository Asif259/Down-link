import { ServiceUnavailableException } from '@nestjs/common';
import * as fs from 'fs';
import { BinaryService } from '../binary/binary.service';
import { HealthController } from './health.controller';

jest.mock('fs');

describe('HealthController', () => {
  let controller: HealthController;
  let binaryService: BinaryService;
  const mockedFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    jest.clearAllMocks();
    binaryService = {
      ytDlpPath: '/app/bin/yt-dlp_linux',
      ffmpegBinaryPath: '/app/node_modules/ffmpeg-static/ffmpeg',
    } as unknown as BinaryService;

    controller = new HealthController(binaryService);
  });

  it('returns status ok when both yt-dlp and ffmpeg binaries exist', () => {
    mockedFs.existsSync.mockReturnValue(true);

    const result = controller.checkHealth();

    expect(result.status).toBe('ok');
    expect(result.binaries).toEqual({ ytDlp: true, ffmpeg: true });
    expect(typeof result.uptime).toBe('number');
  });

  it('throws 503 ServiceUnavailableException when a binary is missing', () => {
    mockedFs.existsSync.mockImplementation((filePath: fs.PathLike) => {
      return !String(filePath).includes('yt-dlp');
    });

    expect(() => controller.checkHealth()).toThrow(ServiceUnavailableException);
  });
});
