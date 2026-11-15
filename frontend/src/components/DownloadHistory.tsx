'use client';

import React from 'react';
import {
  Clock,
  ExternalLink,
  Film,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import {
  formatDuration,
  formatRelativeTime,
  HistoryItem,
  SupportedPlatform,
} from '../lib/media';

const PLATFORM_BADGES: Record<SupportedPlatform, { label: string; classes: string }> = {
  youtube: {
    label: 'YouTube',
    classes: 'bg-red-500/15 text-red-400 border-red-500/30',
  },
  facebook: {
    label: 'Facebook',
    classes: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  },
  instagram: {
    label: 'Instagram',
    classes: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
  },
  tiktok: {
    label: 'TikTok',
    classes: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  },
  unknown: {
    label: 'Media',
    classes: 'bg-slate-800 text-slate-400 border-slate-700',
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
    <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-slate-200">
            Recent Extractions ({items.length})
          </h3>
        </div>

        <button
          type="button"
          onClick={onClearAll}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear History
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((item) => {
          const badge = PLATFORM_BADGES[item.platform] || PLATFORM_BADGES.unknown;
          const isCurrent = activeUrl.trim() === item.url;

          return (
            <div
              key={item.id}
              className={`group relative flex gap-3.5 p-3 rounded-xl border transition-all ${
                isCurrent
                  ? 'bg-slate-950 border-emerald-500/40'
                  : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-700'
              }`}
            >
              {/* Thumbnail */}
              <button
                type="button"
                disabled={isLoading}
                onClick={() => onSelect(item.url)}
                className="relative w-24 h-16 bg-slate-900 rounded-lg overflow-hidden shrink-0 border border-slate-800 cursor-pointer"
              >
                {item.thumbnail ? (
                  <img
                    src={item.thumbnail}
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-600">
                    <Film className="w-5 h-5" />
                  </div>
                )}
                {item.duration > 0 && (
                  <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[10px] font-mono px-1.5 py-0.2 rounded">
                    {formatDuration(item.duration)}
                  </span>
                )}
              </button>

              {/* Metadata & Actions */}
              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <div className="pr-5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-medium border ${badge.classes}`}
                    >
                      {badge.label}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {formatRelativeTime(item.timestamp)}
                    </span>
                  </div>

                  <p className="text-xs font-medium text-slate-200 truncate">
                    {item.title}
                  </p>
                </div>

                <div className="flex items-center justify-between mt-2 pt-1 border-t border-slate-900">
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => onSelect(item.url)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 disabled:opacity-50 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    {item.lastFormatLabel
                      ? `Reload (${item.lastFormatLabel.split(' ')[0]})`
                      : 'Reload Formats'}
                  </button>

                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open original post"
                    className="text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* Remove Single Item Button */}
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                aria-label="Remove from history"
                className="absolute top-2.5 right-2.5 text-slate-600 hover:text-slate-300 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
