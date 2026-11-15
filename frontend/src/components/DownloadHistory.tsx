'use client';

import React from 'react';
import { Clock, Film, RotateCcw, Trash2, X } from 'lucide-react';
import {
  formatDuration,
  formatRelativeTime,
  HistoryItem,
  SupportedPlatform,
} from '../lib/media';

const PLATFORM_LABELS: Record<SupportedPlatform, string> = {
  youtube: 'YouTube',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  unknown: 'Stream',
};

interface DownloadHistoryProps {
  items: HistoryItem[];
  activeUrl: string;
  isLoading: boolean;
  onSelect: (url: string) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
}

export default function DownloadHistory({
  items,
  activeUrl,
  isLoading,
  onSelect,
  onRemove,
  onClearAll,
}: DownloadHistoryProps) {
  if (items.length === 0) return null;

  return (
    <section
      className="space-y-3 pt-6 border-t border-[var(--color-rule)]"
      aria-label="Recent extraction history"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-ink-2)]">
          <Clock className="w-3.5 h-3.5 text-[var(--color-muted)]" />
          <span>Recent extractions</span>
          <span className="font-mono text-[11px] text-[var(--color-muted)]">
            ({items.length})
          </span>
        </div>

        <button
          type="button"
          onClick={onClearAll}
          aria-label="Clear all history"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-error)] rounded-[var(--radius-sm)] hover:bg-[var(--color-paper-3)] transition-colors cursor-pointer"
        >
          <Trash2 className="w-3 h-3" />
          <span>Clear history</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((item) => {
          const isCurrent = activeUrl.trim() === item.url;
          const platformName = PLATFORM_LABELS[item.platform] || 'Stream';

          return (
            <div
              key={item.id}
              className={`group relative flex gap-3 p-3 rounded-[var(--radius-card)] bg-[var(--color-paper-2)] border transition-colors ${
                isCurrent
                  ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/30'
                  : 'border-[var(--color-rule)] hover:border-[var(--color-rule-2)] hover:bg-[var(--color-paper-3)]/40'
              }`}
            >
              <button
                type="button"
                disabled={isLoading}
                onClick={() => onSelect(item.url)}
                aria-label={`Select ${item.title}`}
                className="relative w-24 h-16 sm:w-28 sm:h-18 bg-[var(--color-paper)] rounded-[8px] overflow-hidden shrink-0 border border-[var(--color-rule)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] cursor-pointer"
              >
                {item.thumbnail ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={item.thumbnail}
                    alt=""
                    fetchPriority="low"
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[var(--color-muted)]">
                    <Film className="w-4 h-4" />
                  </div>
                )}
                {item.duration > 0 && (
                  <span className="absolute bottom-1 right-1 bg-[#141415]/90 text-[var(--color-ink)] text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded-[4px] border border-[var(--color-rule)]">
                    {formatDuration(item.duration)}
                  </span>
                )}
              </button>

              <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded-[4px] text-[10px] font-mono text-[var(--color-ink-2)] bg-[var(--color-paper-3)] border border-[var(--color-rule)]">
                      {platformName}
                    </span>
                    <span className="text-[11px] font-mono text-[var(--color-muted)]">
                      {formatRelativeTime(item.timestamp)}
                    </span>
                  </div>

                  <p
                    className="text-xs font-medium text-[var(--color-ink)] line-clamp-1 leading-snug"
                    title={item.title}
                  >
                    {item.title}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--color-rule)]">
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => onSelect(item.url)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-accent)] hover:underline cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reload stream</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onRemove(item.id)}
                    aria-label={`Remove ${item.title} from history`}
                    className="text-[var(--color-muted)] hover:text-[var(--color-ink)] p-1 rounded hover:bg-[var(--color-paper-3)] transition-colors cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
