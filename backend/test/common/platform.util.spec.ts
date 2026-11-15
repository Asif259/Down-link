import { detectPlatform } from '../../src/common/platform.util';

describe('platform.util', () => {
  describe('detectPlatform', () => {
    it('should detect YouTube URLs on valid domains and subdomains', () => {
      expect(detectPlatform('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
      expect(detectPlatform('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
      expect(detectPlatform('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube');
      expect(detectPlatform('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
      expect(detectPlatform('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
      expect(detectPlatform('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('youtube');
      expect(detectPlatform('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('youtube');
      expect(detectPlatform('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('youtube');
    });

    it('should detect Facebook URLs on valid domains and subdomains', () => {
      expect(detectPlatform('https://www.facebook.com/reel/123456789')).toBe('facebook');
      expect(detectPlatform('https://facebook.com/video.php?v=123')).toBe('facebook');
      expect(detectPlatform('https://web.facebook.com/watch/?v=123')).toBe('facebook');
      expect(detectPlatform('https://fb.watch/abc123xyz')).toBe('facebook');
      expect(detectPlatform('https://fb.com/watch?v=123')).toBe('facebook');
      expect(detectPlatform('https://m.facebook.com/share/v/abc123xyz/')).toBe('facebook');
      expect(detectPlatform('https://www.facebook.com/share/r/abc123xyz/')).toBe('facebook');
      expect(detectPlatform('https://www.facebook.com/videos/123456789/')).toBe('facebook');
    });

    it('should detect Instagram URLs on valid domains and subdomains', () => {
      expect(detectPlatform('https://www.instagram.com/reel/C-xyz123/')).toBe('instagram');
      expect(detectPlatform('https://instagram.com/p/C-xyz123/')).toBe('instagram');
      expect(detectPlatform('https://m.instagram.com/reel/C-xyz123/')).toBe('instagram');
      expect(detectPlatform('https://www.instagram.com/reels/C-xyz123/')).toBe('instagram');
      expect(detectPlatform('https://www.instagram.com/tv/C-xyz123/')).toBe('instagram');
      expect(detectPlatform('https://www.instagram.com/share/C-xyz123/')).toBe('instagram');
      expect(detectPlatform('https://instagr.am/p/C-xyz123/')).toBe('instagram');
    });

    it('should detect TikTok URLs on valid domains and subdomains', () => {
      expect(detectPlatform('https://www.tiktok.com/@user/video/1234567890123456789')).toBe('tiktok');
      expect(detectPlatform('https://tiktok.com/@user/video/1234567890123456789')).toBe('tiktok');
      expect(detectPlatform('https://vm.tiktok.com/ZMxxxx/')).toBe('tiktok');
      expect(detectPlatform('https://vt.tiktok.com/ZSxxxx/')).toBe('tiktok');
      expect(detectPlatform('https://m.tiktok.com/v/1234.html')).toBe('tiktok');
    });

    it('should reject domain spoofing / substring injection attacks', () => {
      expect(detectPlatform('https://youtube.com.attacker.com/watch?v=123')).toBe('unknown');
      expect(detectPlatform('https://not-really-youtube.com/watch?v=123')).toBe('unknown');
      expect(detectPlatform('https://fake-facebook.com/reel/123')).toBe('unknown');
      expect(detectPlatform('https://facebook.com.phishing.com/video')).toBe('unknown');
      expect(detectPlatform('https://instagram.com.malicious.net/p/123')).toBe('unknown');
      expect(detectPlatform('https://evil-tiktok.com/@user/video/123')).toBe('unknown');
      expect(detectPlatform('https://tiktok.com.attacker.io/v/123')).toBe('unknown');
    });

    it('should return unknown for unsupported or invalid URLs', () => {
      expect(detectPlatform('https://example.com/video.mp4')).toBe('unknown');
      expect(detectPlatform('not-a-valid-url')).toBe('unknown');
      expect(detectPlatform('javascript:alert(1)')).toBe('unknown');
    });
  });
});
