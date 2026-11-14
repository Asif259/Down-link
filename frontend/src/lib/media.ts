export type SupportedPlatform = 'youtube' | 'facebook' | 'instagram' | 'tiktok' | 'unknown';

export interface CleanFormat {
  formatId: string;
  label: string;
  ext: string;
  type: 'video' | 'audio';
  resolution?: string;
  filesizeApprox?: number;
  needsMerge: boolean;
  streamToken?: string;
}

export interface MediaInfoResponse {
  platform: SupportedPlatform;
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  formats: CleanFormat[];
}

export interface JobProgress {
  status: 'starting' | 'downloading' | 'merging' | 'ready' | 'error';
  percent: number;
  message?: string;
}

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');

export function detectClientPlatform(rawUrl: string): SupportedPlatform {
  const trimmed = rawUrl.trim();
  if (!trimmed) return 'unknown';

  try {
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const host = new URL(normalized).hostname.toLowerCase();

    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('facebook.com') || host.includes('fb.watch')) return 'facebook';
    if (host.includes('instagram.com')) return 'instagram';
    if (host.includes('tiktok.com')) return 'tiktok';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatBytes(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}
