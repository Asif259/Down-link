import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DownloadQueryDto, ExtractMediaDto } from '../../src/media/dto/media.dto';

describe('Media DTOs', () => {
  describe('ExtractMediaDto', () => {
    it('should validate a correct URL', async () => {
      const dto = plainToInstance(ExtractMediaDto, {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject invalid or non-http URLs', async () => {
      const dto = plainToInstance(ExtractMediaDto, {
        url: 'ftp://invalid-protocol.com/file',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('DownloadQueryDto', () => {
    it('should validate a safe query payload', async () => {
      const dto = plainToInstance(DownloadQueryDto, {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        formatId: '137+140',
        type: 'video',
        jobId: 'job_12345',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject formatId containing shell injection characters', async () => {
      const dto = plainToInstance(DownloadQueryDto, {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        formatId: '137; rm -rf /',
        type: 'video',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject invalid type parameter', async () => {
      const dto = plainToInstance(DownloadQueryDto, {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        formatId: 'bestaudio',
        type: 'unknown_type' as any,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
