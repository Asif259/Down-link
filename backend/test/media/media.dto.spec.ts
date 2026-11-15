import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DownloadQueryDto, ExtractMediaDto, UpdateCookiesDto } from '../../src/media/dto/media.dto';

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

    it('should reject empty URL', async () => {
      const dto = plainToInstance(ExtractMediaDto, {
        url: '',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('DownloadQueryDto', () => {
    it('should validate safe standard and DASH format selectors', async () => {
      const payloads = [
        { formatId: '137+140', type: 'video' },
        { formatId: '137+bestaudio[ext=m4a]/best', type: 'video' },
        { formatId: 'bestvideo+bestaudio/best', type: 'video' },
        { formatId: 'bestaudio', type: 'audio' },
        { formatId: '18', type: 'video' },
      ];

      for (const p of payloads) {
        const dto = plainToInstance(DownloadQueryDto, {
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          formatId: p.formatId,
          type: p.type,
          jobId: 'job_12345',
        });
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
      }
    });

    it('should reject formatId containing shell injection characters', async () => {
      const injectionAttempts = [
        '137; rm -rf /',
        '137 | cat /etc/passwd',
        '137 && echo pwned',
        '137`whoami`',
        '137$(whoami)',
        '137>output.txt',
        '137<input.txt',
        '137" OR "1"="1',
        "137' OR '1'='1",
      ];

      for (const formatId of injectionAttempts) {
        const dto = plainToInstance(DownloadQueryDto, {
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          formatId,
          type: 'video',
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      }
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

  describe('UpdateCookiesDto', () => {
    it('should validate when secret and cookies are non-empty strings', async () => {
      const dto = plainToInstance(UpdateCookiesDto, {
        secret: 'admin123',
        cookies: '# Netscape HTTP Cookie File\n.youtube.com TRUE / FALSE 1999999999 SID test',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject missing or empty secret', async () => {
      const dto = plainToInstance(UpdateCookiesDto, {
        secret: '',
        cookies: 'cookie_data',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject missing or empty cookies', async () => {
      const dto = plainToInstance(UpdateCookiesDto, {
        secret: 'admin123',
        cookies: '',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
