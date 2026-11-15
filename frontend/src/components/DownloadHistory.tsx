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
    label: 'YouTube',
    classes: 'bg-red-500/15 text-red-400 border-red-500/30',
    spotlight: 'rgba(239, 68, 68, 0.16)',
  },
  facebook: {
    label: 'Facebook',
    classes: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    spotlight: 'rgba(59, 130, 246, 0.16)',
  },
  instagram: {
    label: 'Instagram',
    classes: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
    spotlight: 'rgba(236, 72, 153, 0.16)',
  },
  tiktok: {
    label: 'TikTok',
    classes: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    spotlight: 'rgba(6, 182, 212, 0.16)',
  },
  unknown: {
    label: 'Media',
    classes: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    spotlight: 'rgba(16, 185, 129, 0.14)',
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
    <section className="space-y-4 pt-4" aria-label="Recent Extractions History">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-zinc-200 tracking-tight">
            Recent Extractions ({items.length})
          </h3>
        </div>

        <button
          type="button"
          onClick={onClearAll}
          aria-label="Clear all extraction history"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-red-400 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 transition-colors cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear All
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {items.map((item) => {
          const badge = PLATFORM_BADGES[item.platform] || PLATFORM_BADGES.unknown;
          const isCurrent = activeUrl.trim() === item.url;

          return (
            <SpotlightCard
              key={item.id}
              spotlightColor={badge.spotlight}
              className={`p-3.5 group ${
                isCurrent ? 'border-emerald-500/40 ring-1 ring-emerald-500/30' : ''
              }`}
            >
              <div className="flex gap-3.5 items-stretch">
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => onSelect(item.url)}
                  aria-label={`Reload streams for ${item.title}`}
                  className="relative w-28 h-20 bg-zinc-950 rounded-xl overflow-hidden shrink-0 border border-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 transition-all cursor-pointer"
                >
                  {item.thumbnail ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={item.thumbnail}
                      alt={item.title || 'Thumbnail preview'}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-600">
                      <Film className="w-5 h-5" />
                    </div>
                  )}
                  {item.duration > 0 && (
                    <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[10px] font-mono px-1.5 py-0.5 rounded">
                      {formatDuration(item.duration)}
                    </span>
                  )}
                </button>

                <div className="flex-1 min-w-0 flex flex-col justify-between">
                  <div className="pr-6 space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badge.classes}`}
                      >
                        {badge.label}
                      </span>
                      <span className="text-[11px] text-zinc-400 font-medium">
                        {formatRelativeTime(item.timestamp)}
                      </span>
                    </div>

                    <p className="text-xs font-semibold text-zinc-100 truncate" title={item.title}>
                      {item.title}
                    </p>
                  </div>

                  <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-white/5">
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => onSelect(item.url)}
                      aria-label={`Reload ${item.lastFormatLabel ? item.lastFormatLabel.split(' ')[0] : 'stream'} for ${item.title}`}
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded-md px-1 py-0.5 disabled:opacity-50 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      {item.lastFormatLabel
                        ? `Reload (${item.lastFormatLabel.split(' ')[0]})`
                        : 'Reload Streams'}
                    </button>

                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open source link in new tab"
                      aria-label="Open source link in new tab"
                      className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded-lg hover:bg-white/5 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  aria-label={`Remove ${item.title} from history`}
                  className="absolute top-2.5 right-2.5 w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 transition-colors cursor-pointer"
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
