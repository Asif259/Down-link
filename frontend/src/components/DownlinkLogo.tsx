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
    sm: {
      box: 'w-9 h-9 rounded-lg',
      icon: 22,
      text: 'text-base font-semibold',
      dot: 'w-1.5 h-1.5',
      gap: 'gap-2.5',
    },
    md: {
      box: 'w-11 h-11 rounded-xl',
      icon: 28,
      text: 'text-xl sm:text-2xl font-bold',
      dot: 'w-2 h-2',
      gap: 'gap-3 sm:gap-3.5',
    },
    lg: {
      box: 'w-14 h-14 rounded-2xl',
      icon: 36,
      text: 'text-2xl sm:text-3xl font-bold',
      dot: 'w-2.5 h-2.5',
      gap: 'gap-4',
    },
  }[size];

  const clampedProgress = Math.min(100, Math.max(0, progress));

  return (
    <div
      className={`group inline-flex items-center ${dimensions.gap} select-none ${className}`}
    >
      {/* Anodized Keycap Container */}
      <div
        className={`relative flex items-center justify-center bg-zinc-900 border border-white/[0.14] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2),0_2px_10px_rgba(0,0,0,0.5)] transition-colors duration-300 group-hover:border-white/[0.25] ${dimensions.box}`}
      >
        {/* Subtle bottom ambient tint */}
        <div
          className="pointer-events-none absolute inset-x-1.5 bottom-0 h-3 opacity-30 blur-sm transition-colors duration-500"
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
                : { y: 0, opacity: 0.9 }
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
            viewBox="0 0 44 44"
            className="pointer-events-none absolute -inset-[1px] w-[calc(100%+2px)] h-[calc(100%+2px)]"
          >
            <rect
              x="1"
              y="1"
              width="42"
              height="42"
              rx="12"
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
        <div className="flex items-center gap-2.5">
          <span
            className={`font-bold tracking-[-0.035em] text-white ${dimensions.text}`}
          >
            downlink
          </span>
          <span
            className={`${dimensions.dot} rounded-full transition-colors duration-500 shadow-sm ${
              isBusy ? 'animate-ping' : ''
            }`}
            style={{ backgroundColor: accent }}
          />
        </div>
      )}
    </div>
  );
}
