import { detectPlatform } from '../../src/common/platform.util';

describe('platform.util', () => {
  describe('detectPlatform', () => {
    it('should detect YouTube URLs', () => {
      expect(detectPlatform('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
      expect(detectPlatform('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube');
      expect(detectPlatform('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
    });

    it('should detect Facebook URLs', () => {
      expect(detectPlatform('https://www.facebook.com/reel/123456789')).toBe('facebook');
      expect(detectPlatform('https://fb.watch/abc123xyz')).toBe('facebook');
    });

    it('should detect Instagram URLs', () => {
      expect(detectPlatform('https://www.instagram.com/reel/C-xyz123/')).toBe('instagram');
      expect(detectPlatform('https://instagram.com/p/C-xyz123/')).toBe('instagram');
    });

    it('should detect TikTok URLs', () => {
      expect(detectPlatform('https://www.tiktok.com/@user/video/1234567890123456789')).toBe('tiktok');
      expect(detectPlatform('https://vm.tiktok.com/ZMxxxx/')).toBe('tiktok');
    });

    it('should return unknown for unsupported or invalid URLs', () => {
      expect(detectPlatform('https://example.com/video.mp4')).toBe('unknown');
      expect(detectPlatform('not-a-valid-url')).toBe('unknown');
    });
  });
});
