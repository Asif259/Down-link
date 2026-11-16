'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { SupportedPlatform } from '../lib/media';

export type LogoActivityState = 'idle' | 'extracting' | 'downloading' | 'ready';

const PLATFORM_ACCENTS: Record<SupportedPlatform, string> = {
  youtube: '#ef4444',
  facebook: '#3b82f6',
  instagram: '#ec4899',
  tiktok: '#06b6d4',
  unknown: '#10b981',
};

interface DownlinkLogoProps {
  platform?: SupportedPlatform;
  activity?: LogoActivityState;
  progress?: number;
  variant?: 'full' | 'mark';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export default function DownlinkLogo({
  platform = 'unknown',
  activity = 'idle',
  progress = 0,
  variant = 'full',
  size = 'md',
  className = '',
}: DownlinkLogoProps) {
  const accent = PLATFORM_ACCENTS[platform] || PLATFORM_ACCENTS.unknown;
  const isBusy = activity === 'extracting' || activity === 'downloading';

  const dimensions = {
    sm: { box: 'w-8 h-8 rounded-lg', icon: 18, text: 'text-base' },
    md: { box: 'w-9 h-9 rounded-xl', icon: 20, text: 'text-lg' },
    lg: { box: 'w-11 h-11 rounded-xl', icon: 24, text: 'text-xl' },
  }[size];

  const clampedProgress = Math.min(100, Math.max(0, progress));

  return (
    <div
      className={`group inline-flex items-center gap-2.5 select-none ${className}`}
    >
      {/* Anodized Keycap Container */}
      <div
        className={`relative flex items-center justify-center bg-zinc-900 border border-white/[0.12] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_2px_8px_rgba(0,0,0,0.4)] transition-colors duration-300 group-hover:border-white/[0.22] ${dimensions.box}`}
      >
        {/* Subtle bottom ambient tint */}
        <div
          className="pointer-events-none absolute inset-x-1 bottom-0 h-2.5 opacity-25 blur-sm transition-colors duration-500"
          style={{ backgroundColor: accent }}
        />

        {/* 24x24 Swiss-Grid Geometric Vector */}
        <svg
          width={dimensions.icon}
          height={dimensions.icon}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="relative z-10 overflow-visible"
        >
          {/* Upper 45-deg Link Cap (lifts slightly on hover or extraction) */}
          <motion.path
            d="M7 10L12 5L17 10L15.25 11.75L12 8.5L8.75 11.75L7 10Z"
            fill={accent}
            animate={
              isBusy
                ? { y: [-1, 0.5, -1], opacity: [0.6, 1, 0.6] }
                : { y: 0, opacity: 0.85 }
            }
            transition={
              isBusy
                ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' }
                : { duration: 0.2 }
            }
            className="transition-transform duration-200 group-hover:-translate-y-[1.5px]"
          />

          {/* Lower Precision Arrow & Central Shaft */}
          <motion.path
            d="M10.75 10H13.25V15.15L15.8 12.6L17.55 14.35L12 19.9L6.45 14.35L8.2 12.6L10.75 15.15V10Z"
            fill="#FAFAFA"
            animate={
              isBusy ? { y: [1, -0.5, 1] } : { y: 0 }
            }
            transition={
              isBusy
                ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' }
                : { duration: 0.2 }
            }
            className="transition-transform duration-200 group-hover:translate-y-[1.5px]"
          />
        </svg>

        {/* Minimalist Perimeter Progress Trace (Only visible during FFmpeg download) */}
        {activity === 'downloading' && (
          <svg
            viewBox="0 0 36 36"
            className="pointer-events-none absolute -inset-[1px] w-[calc(100%+2px)] h-[calc(100%+2px)]"
          >
            <rect
              x="1"
              y="1"
              width="34"
              height="34"
              rx="11"
              fill="none"
              stroke={accent}
              strokeWidth="1.5"
              pathLength={100}
              strokeDasharray="100"
              strokeDashoffset={100 - clampedProgress}
              className="transition-all duration-300"
            />
          </svg>
        )}
      </div>

      {/* Clean Studio Wordmark */}
      {variant === 'full' && (
        <div className="flex items-center gap-2">
          <span
            className={`font-semibold tracking-[-0.03em] text-zinc-100 ${dimensions.text}`}
          >
            downlink
          </span>
          <span
            className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${
              isBusy ? 'animate-ping' : ''
            }`}
            style={{ backgroundColor: accent }}
          />
        </div>
      )}
    </div>
  );
}
