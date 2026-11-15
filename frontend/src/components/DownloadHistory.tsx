'use client';

import React from 'react';
import { Clock, ExternalLink, Film, RotateCcw, Trash2, X } from 'lucide-react';
import SpotlightCard from './react-bits/SpotlightCard';
import {
  formatDuration,
  formatRelativeTime,
  HistoryItem,
  SupportedPlatform,
} from '../lib/media';

const PLATFORM_BADGES: Record<
  SupportedPlatform,
  { label: string; classes: string; spotlight: string }
> = {
  youtube: {
    label: 'youtube',
    classes: 'bg-[var(--color-paper-3)] text-[var(--color-accent-2)] border-[var(--color-rule-2)]',
    spotlight: 'oklch(72% 0.15 12 / 0.16)',
  },
  facebook: {
    label: 'facebook',
    classes: 'bg-[var(--color-paper-3)] text-[var(--color-ink-2)] border-[var(--color-rule-2)]',
    spotlight: 'oklch(85% 0.017 298 / 0.16)',
  },
  instagram: {
    label: 'instagram',
    classes: 'bg-[var(--color-paper-3)] text-[var(--color-accent-2)] border-[var(--color-rule-2)]',
    spotlight: 'oklch(72% 0.15 12 / 0.16)',
  },
  tiktok: {
    label: 'tiktok',
    classes: 'bg-[var(--color-paper-3)] text-[var(--color-accent)] border-[var(--color-rule-2)]',
    spotlight: 'oklch(80% 0.15 62 / 0.16)',
  },
  unknown: {
    label: 'stream',
    classes: 'bg-[var(--color-paper-3)] text-[var(--color-muted)] border-[var(--color-rule)]',
    spotlight: 'oklch(80% 0.13 155 / 0.14)',
  },
};

interface DownloadHistoryProps {
  items: HistoryItem[];
  activeUrl: string;
  isLoading: boolean;
  onSelect: (url: string) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
}

function DownloadHistory({
  items,
  activeUrl,
  isLoading,
  onSelect,
  onRemove,
  onClearAll,
}: DownloadHistoryProps) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-4 pt-6 border-t border-[var(--color-rule)] [contain:content]" aria-label="Recent extractions history">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-[var(--color-accent)]" />
          <h3 className="text-sm font-medium text-[var(--color-ink)] lowercase tracking-normal">
            recent extractions ({items.length})
          </h3>
        </div>

        <button
          type="button"
          onClick={onClearAll}
          aria-label="Clear all extraction history"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-[var(--radius-pill)] text-xs text-[var(--color-muted)] hover:text-[var(--color-error)] active:scale-[0.98] hover:bg-[var(--color-paper-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-error)] motion-safe:transition-transform motion-reduce:transition-none cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5 shrink-0" />
          clear all
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
        {items.map((item) => {
          const badge = PLATFORM_BADGES[item.platform] || PLATFORM_BADGES.unknown;
          const isCurrent = activeUrl.trim() === item.url;

          return (
            <SpotlightCard
              key={item.id}
              spotlightColor={badge.spotlight}
              className={`p-3 sm:p-3.5 group [content-visibility:auto] [contain-intrinsic-size:auto_90px] border-[var(--color-rule)] bg-[var(--color-paper-2)] rounded-[var(--radius-card)] ${
                isCurrent ? 'ring-1 ring-[var(--color-accent)] border-[var(--color-accent)]' : ''
              }`}
            >
              <div className="flex gap-3 sm:gap-3.5 items-stretch">
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => onSelect(item.url)}
                  aria-label={`Reload streams for ${item.title}`}
                  className="relative w-24 h-18 sm:w-28 sm:h-20 bg-[var(--color-paper)] rounded-[8px] overflow-hidden shrink-0 border border-[var(--color-rule)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] transition-colors cursor-pointer"
                >
                  {item.thumbnail ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={item.thumbnail}
                      alt={item.title || 'Thumbnail preview'}
                      fetchPriority="high"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[var(--color-muted)]">
                      <Film className="w-5 h-5" />
                    </div>
                  )}
                  {item.duration > 0 && (
                    <span className="absolute bottom-1 right-1 bg-[var(--color-paper-3)] text-[var(--color-ink)] text-[10px] font-mono px-1.5 py-0.5 rounded border border-[var(--color-rule)]">
                      {formatDuration(item.duration)}
                    </span>
                  )}
                </button>

                <div className="flex-1 min-w-0 flex flex-col justify-between">
                  <div className="pr-8 sm:pr-7 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded-[var(--radius-pill)] text-[10px] font-medium border lowercase ${badge.classes}`}
                      >
                        {badge.label}
                      </span>
                      <span className="text-[11px] text-[var(--color-muted)] font-mono">
                        {formatRelativeTime(item.timestamp)}
                      </span>
                    </div>

                    <p className="text-xs font-normal text-[var(--color-ink)] truncate" title={item.title}>
                      {item.title}
                    </p>
                  </div>

                  <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-[var(--color-rule)] gap-2">
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => onSelect(item.url)}
                      aria-label={`Reload ${item.lastFormatLabel ? item.lastFormatLabel.split(' ')[0] : 'stream'} for ${item.title}`}
                      className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-medium text-[var(--color-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-paper)] rounded px-1.5 py-1 min-h-[34px] transition-colors disabled:opacity-50 cursor-pointer truncate"
                    >
                      <RotateCcw className="w-3 h-3 shrink-0" />
                      <span className="truncate lowercase">
                        {item.lastFormatLabel
                          ? `reload (${item.lastFormatLabel.split(' ')[0].toLowerCase()})`
                          : 'reload stream'}
                      </span>
                    </button>

                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open source link in new tab"
                      aria-label="Open source link in new tab"
                      className="w-8 h-8 sm:w-7 sm:h-7 shrink-0 flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-paper)] rounded-[var(--radius-pill)] hover:bg-[var(--color-paper-3)] transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  aria-label={`Remove ${item.title} from history`}
                  className="absolute top-2 right-2 w-8 h-8 sm:w-7 sm:h-7 flex items-center justify-center rounded-[var(--radius-pill)] text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-paper-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-error)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-paper)] transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </SpotlightCard>
          );
        })}
      </div>
    </section>
  );
}

export default React.memo(DownloadHistory);
