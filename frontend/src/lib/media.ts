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

export function cleanUrlInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Extract the true URL if multiple URLs were accidentally glued together:
  // e.g. "https://youtu.be/xyzhttps://youtu.be/xyz" -> "https://youtu.be/xyz"
  const parts = trimmed.split(/(?=https?:\/\/)/i).filter(Boolean);
  if (parts.length > 1) {
    return (parts[parts.length - 1] || parts[0]).trim();
  }
  return trimmed;
}

export function detectClientPlatform(rawUrl: string): SupportedPlatform {
  const trimmed = cleanUrlInput(rawUrl);
  if (!trimmed) return 'unknown';

  try {
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const host = new URL(normalized).hostname.toLowerCase();

    if (/(^|\.)youtube\.com$/i.test(host) || /(^|\.)youtu\.be$/i.test(host)) return 'youtube';
    if (/(^|\.)facebook\.com$/i.test(host) || /(^|\.)fb\.watch$/i.test(host) || /(^|\.)fb\.com$/i.test(host)) return 'facebook';
    if (/(^|\.)instagram\.com$/i.test(host) || /(^|\.)instagr\.am$/i.test(host)) return 'instagram';
    if (/(^|\.)tiktok\.com$/i.test(host)) return 'tiktok';
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

export interface HistoryItem {
  id: string;
  url: string;
  platform: SupportedPlatform;
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  lastFormatLabel?: string;
  timestamp: number;
}

const HISTORY_STORAGE_KEY = 'downlink_media_history_v1';
const MAX_HISTORY_ITEMS = 12;

export function loadHistory(): HistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistoryItem(
  item: Omit<HistoryItem, 'id' | 'timestamp'>,
): HistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const current = loadHistory();
    const normalizedUrl = item.url.trim();

    // Remove existing entry for the same URL so the updated one moves to the top
    const existing = current.find((entry) => entry.url === normalizedUrl);
    const filtered = current.filter((entry) => entry.url !== normalizedUrl);

    const nextItem: HistoryItem = {
      ...item,
      url: normalizedUrl,
      lastFormatLabel: item.lastFormatLabel || existing?.lastFormatLabel,
      id: existing?.id || `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
    };

    const updated = [nextItem, ...filtered].slice(0, MAX_HISTORY_ITEMS);
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export function removeHistoryItem(id: string): HistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const updated = loadHistory().filter((item) => item.id !== id);
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export function clearAllHistory(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

export function formatRelativeTime(timestamp: number): string {
  const diffSeconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return 'Just now';
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
