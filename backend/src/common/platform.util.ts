export type SupportedPlatform = 'youtube' | 'facebook' | 'instagram' | 'tiktok' | 'unknown';

export function detectPlatform(rawUrl: string): SupportedPlatform {
  try {
    const trimmed = (rawUrl || '').trim();
    if (!trimmed) return 'unknown';

    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'unknown';
    }
    const hostname = parsed.hostname.toLowerCase();

    // Exact domain or anchored subdomain matching to prevent domain substring spoofing
    if (
      /(^|\.)youtube\.com$/i.test(hostname) ||
      /(^|\.)youtu\.be$/i.test(hostname)
    ) {
      return 'youtube';
    }

    if (
      /(^|\.)facebook\.com$/i.test(hostname) ||
      /(^|\.)fb\.watch$/i.test(hostname) ||
      /(^|\.)fb\.com$/i.test(hostname)
    ) {
      return 'facebook';
    }

    if (
      /(^|\.)instagram\.com$/i.test(hostname) ||
      /(^|\.)instagr\.am$/i.test(hostname)
    ) {
      return 'instagram';
    }

    if (/(^|\.)tiktok\.com$/i.test(hostname)) {
      return 'tiktok';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}
