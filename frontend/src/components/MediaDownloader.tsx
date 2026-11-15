'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowDownToLine,
  CheckCircle2,
  ClipboardPaste,
  Film,
  Loader2,
  Music,
  Sparkles,
  Tv,
  X,
  Zap,
} from 'lucide-react';
import Aurora from './react-bits/Aurora';
import BlurText from './react-bits/BlurText';
import Magnet from './react-bits/Magnet';
import ShinyText from './react-bits/ShinyText';
import SpotlightCard from './react-bits/SpotlightCard';
import StarBorder from './react-bits/StarBorder';
import DownloadHistory from './DownloadHistory';
import {
  API_BASE_URL,
  CleanFormat,
  cleanUrlInput,
  clearAllHistory,
  detectClientPlatform,
  formatBytes,
  formatDuration,
  HistoryItem,
  JobProgress,
  loadHistory,
  MediaInfoResponse,
  removeHistoryItem,
  saveHistoryItem,
  SupportedPlatform,
} from '../lib/media';

const PLATFORM_THEMES: Record<
  SupportedPlatform,
  {
    name: string;
    accentHex: string;
    spotlightRgba: string;
    auroraStops: [string, string, string];
    pillClasses: string;
    buttonClasses: string;
  }
> = {
  youtube: {
    name: 'YouTube Engine',
    accentHex: '#ef4444',
    spotlightRgba: 'rgba(239, 68, 68, 0.22)',
    auroraStops: ['#ef4444', '#f97316', '#dc2626'],
    pillClasses: 'bg-red-500/10 text-red-400 border-red-500/30',
    buttonClasses: 'from-red-600 to-orange-600 shadow-red-600/25',
  },
  facebook: {
    name: 'Facebook Engine',
    accentHex: '#3b82f6',
    spotlightRgba: 'rgba(59, 130, 246, 0.22)',
    auroraStops: ['#2563eb', '#38bdf8', '#4f46e5'],
    pillClasses: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    buttonClasses: 'from-blue-600 to-indigo-600 shadow-blue-600/25',
  },
  instagram: {
    name: 'Instagram Engine',
    accentHex: '#ec4899',
    spotlightRgba: 'rgba(236, 72, 153, 0.22)',
    auroraStops: ['#ec4899', '#8b5cf6', '#f59e0b'],
    pillClasses: 'bg-pink-500/10 text-pink-400 border-pink-500/30',
    buttonClasses: 'from-pink-600 via-purple-600 to-orange-500 shadow-pink-600/25',
  },
  tiktok: {
    name: 'TikTok Engine',
    accentHex: '#06b6d4',
    spotlightRgba: 'rgba(6, 182, 212, 0.22)',
    auroraStops: ['#06b6d4', '#f43f5e', '#10b981'],
    pillClasses: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
    buttonClasses: 'from-cyan-500 to-emerald-500 shadow-cyan-500/25',
  },
  unknown: {
    name: 'Universal Extractor',
    accentHex: '#10b981',
    spotlightRgba: 'rgba(16, 185, 129, 0.18)',
    auroraStops: ['#10b981', '#06b6d4', '#6366f1'],
    pillClasses: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
    buttonClasses: 'from-emerald-500 to-teal-500 shadow-emerald-500/25',
  },
};

const PLATFORM_SHOWCASE: Array<{
  platform: SupportedPlatform;
  label: string;
  tag: string;
  dotColor: string;
  placeholder: string;
}> = [
  {
    platform: 'youtube',
    label: 'YouTube',
    tag: '1080p HD & MP3',
    dotColor: '#ef4444',
    placeholder: 'https://www.youtube.com/watch?v=...',
  },
  {
    platform: 'tiktok',
    label: 'TikTok',
    tag: 'No Watermark',
    dotColor: '#06b6d4',
    placeholder: 'https://www.tiktok.com/@user/video/...',
  },
  {
    platform: 'instagram',
    label: 'Instagram',
    tag: 'Reels & Audio',
    dotColor: '#ec4899',
    placeholder: 'https://www.instagram.com/reel/...',
  },
  {
    platform: 'facebook',
    label: 'Facebook',
    tag: 'HD Watch',
    dotColor: '#3b82f6',
    placeholder: 'https://www.facebook.com/watch/?v=...',
  },
];

const DEMO_SAMPLE_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

export default function MediaDownloader() {
  const [url, setUrl] = useState('');
  const [detectedPlatform, setDetectedPlatform] = useState<SupportedPlatform>('unknown');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaInfoResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'video' | 'audio'>('video');
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const [activeFormatId, setActiveFormatId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory(loadHistory());
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const theme = PLATFORM_THEMES[media?.platform || detectedPlatform];

  const handleUrlChange = (value: string) => {
    const cleaned = cleanUrlInput(value);
    setUrl(cleaned);
    setDetectedPlatform(detectClientPlatform(cleaned));
    if (error) setError(null);
  };

  const fetchMediaInfo = async (targetUrl: string) => {
    const cleanUrl = cleanUrlInput(targetUrl);
    if (!cleanUrl) return;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setError('You are currently offline. Check your internet connection and try again.');
      return;
    }

    const platform = detectClientPlatform(cleanUrl);
    setDetectedPlatform(platform);

    if (platform === 'unknown') {
      setError('Paste a valid YouTube, Facebook, Instagram, or TikTok URL.');
      return;
    }

    setLoading(true);
    setError(null);
    setMedia(null);
    setJobProgress(null);
    setActiveFormatId(null);
    eventSourceRef.current?.close();

    try {
      const response = await fetch(`${API_BASE_URL}/api/media/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cleanUrl }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Unable to extract media from this link.');
      }

      setMedia(data);
      const hasVideo = data.formats.some((f: CleanFormat) => f.type === 'video');
      setActiveTab(hasVideo ? 'video' : 'audio');

      const updatedHistory = saveHistoryItem({
        url: cleanUrl,
        platform: data.platform,
        title: data.title,
        thumbnail: data.thumbnail,
        duration: data.duration,
        uploader: data.uploader,
      });
      setHistory(updatedHistory);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong while fetching media.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    if (pastedText) {
      const cleaned = cleanUrlInput(pastedText);
      handleUrlChange(cleaned);
      fetchMediaInfo(cleaned);
    }
  };

  const handleClipboardButton = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const cleaned = cleanUrlInput(text);
        handleUrlChange(cleaned);
        fetchMediaInfo(cleaned);
      }
    } catch {
      setError('Clipboard permission blocked. Press Cmd+V or Ctrl+V inside the input box.');
    }
  };

  const triggerBrowserDownload = (downloadUrl: string) => {
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const handleDownloadClick = (format: CleanFormat) => {
    if (!media) return;

    const updatedHistory = saveHistoryItem({
      url: url.trim(),
      platform: media.platform,
      title: media.title,
      thumbnail: media.thumbnail,
      duration: media.duration,
      uploader: media.uploader,
      lastFormatLabel: format.label,
    });
    setHistory(updatedHistory);

    if (!format.needsMerge && format.streamToken) {
      triggerBrowserDownload(`${API_BASE_URL}/api/media/stream/${format.streamToken}`);
      return;
    }

    eventSourceRef.current?.close();
    // eslint-disable-next-line react-hooks/purity
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    setActiveFormatId(format.formatId);
    setJobProgress({ status: 'starting', percent: 5 });

    const sse = new EventSource(`${API_BASE_URL}/api/media/progress/${jobId}`);
    eventSourceRef.current = sse;

    sse.onmessage = (event) => {
      try {
        const parsed: JobProgress = JSON.parse(event.data);
        setJobProgress(parsed);

        if (parsed.status === 'ready' || parsed.status === 'error') {
          sse.close();
          if (parsed.status === 'error') {
            setError(parsed.message || 'Media conversion failed.');
          }
          setTimeout(() => {
            setActiveFormatId(null);
          }, 2500);
        }
      } catch {
        // Ignore heartbeat noise
      }
    };

    sse.onerror = () => {
      sse.close();
    };

    const params = new URLSearchParams({
      url: url.trim(),
      formatId: format.formatId,
      type: format.type,
      jobId,
    });

    setTimeout(() => {
      triggerBrowserDownload(`${API_BASE_URL}/api/media/download?${params.toString()}`);
    }, 150);
  };

  const filteredFormats =
    media?.formats.filter((format) => format.type === activeTab) || [];

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#030712] text-zinc-100 selection:bg-emerald-500/30 selection:text-emerald-200">
      <Aurora colorStops={theme.auroraStops} speed={0.7} amplitude={1.2} />

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#ffffff06_1px,transparent_1px),linear-gradient(to_bottom,#ffffff06_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 pt-16 pb-24 space-y-10">
        <header className="text-center space-y-5 max-w-2xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-white/10 bg-white/[0.04] backdrop-blur-md shadow-inner"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <ShinyText
              text="Zero-Watermark • Instant CDN Stream • 1080p HD Muxer"
              className="text-xs font-medium tracking-wide"
            />
          </motion.div>

          <BlurText
            text="Download Media From Any Platform in Seconds."
            className="text-3xl sm:text-5xl font-bold tracking-tight text-white leading-[1.12]"
          />

          <p className="text-sm sm:text-base text-zinc-400 max-w-xl mx-auto leading-relaxed">
            Paste a link from{' '}
            <span className="text-zinc-200 font-medium">YouTube</span>,{' '}
            <span className="text-zinc-200 font-medium">Facebook</span>,{' '}
            <span className="text-zinc-200 font-medium">Instagram</span>, or{' '}
            <span className="text-zinc-200 font-medium">TikTok</span>. Automatically detects
            streams and delivers crisp MP4 video or studio-grade MP3 audio.
          </p>
        </header>

        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all duration-300 ${theme.pillClasses}`}
              >
                <span
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{ backgroundColor: theme.accentHex }}
                />
                {theme.name}
              </span>
            </div>

            <button
              type="button"
              onClick={handleClipboardButton}
              aria-label="Paste URL from clipboard"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 px-3 py-1.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 transition-all cursor-pointer"
            >
              <ClipboardPaste className="w-3.5 h-3.5 text-emerald-400" />
              Paste from Clipboard
            </button>
          </div>

          <StarBorder color={theme.accentHex}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                fetchMediaInfo(url);
              }}
              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2.5"
            >
              <div className="relative flex-1 flex items-center">
                <input
                  id="media-url-input"
                  aria-label="Media link from YouTube, TikTok, Instagram, or Facebook"
                  type="url"
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  onPaste={handlePaste}
                  placeholder={
                    PLATFORM_SHOWCASE.find((p) => p.platform === detectedPlatform)?.placeholder ||
                    'https://www.youtube.com/watch?v=... or TikTok / Reel link'
                  }
                  className="w-full bg-transparent pl-4 pr-10 py-3.5 text-sm sm:text-base text-white placeholder-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 rounded-xl"
                  required
                />
                {url && (
                  <button
                    type="button"
                    onClick={() => {
                      setUrl('');
                      setDetectedPlatform('unknown');
                      setMedia(null);
                      setError(null);
                    }}
                    aria-label="Clear URL input"
                    className="absolute right-3 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <Magnet strength={0.18} disabled={loading || !url.trim()}>
                <button
                  type="submit"
                  disabled={loading || !url.trim()}
                  aria-label={loading ? 'Extracting media streams...' : 'Extract media streams'}
                  className={`w-full sm:w-auto inline-flex items-center justify-center gap-2.5 bg-gradient-to-r ${theme.buttonClasses} hover:brightness-110 disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-500 disabled:shadow-none text-white font-semibold text-sm px-7 py-3.5 rounded-xl shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-all cursor-pointer`}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Extracting...
                    </>
                  ) : (
                    <>
                      <ArrowDownToLine className="w-4 h-4" />
                      Extract Media
                    </>
                  )}
                </button>
              </Magnet>
            </form>
          </StarBorder>

          <div className="pt-2 flex flex-wrap items-center justify-between gap-2.5 px-1">
            <div className="flex flex-wrap items-center gap-2">
              {PLATFORM_SHOWCASE.map((item) => {
                const isSelected =
                  (media?.platform || detectedPlatform) === item.platform;
                return (
                  <button
                    key={item.platform}
                    type="button"
                    onClick={() => setDetectedPlatform(item.platform)}
                    aria-label={`Select ${item.label} platform`}
                    aria-pressed={isSelected}
                    className={`group inline-flex items-center gap-2 px-3.5 py-2 min-h-[38px] rounded-xl text-xs font-medium border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-white/10 border-white/25 text-white shadow-sm'
                        : 'bg-white/[0.02] border-white/10 text-zinc-300 hover:text-white hover:bg-white/[0.05]'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full transition-transform group-hover:scale-125"
                      style={{ backgroundColor: item.dotColor }}
                    />
                    <span className="font-semibold text-zinc-100">{item.label}</span>
                    <span className="text-[11px] text-zinc-400 hidden sm:inline">
                      • {item.tag}
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={loading}
              onClick={() => {
                handleUrlChange(DEMO_SAMPLE_URL);
                fetchMediaInfo(DEMO_SAMPLE_URL);
              }}
              aria-label="Try 1-Click Demo with sample YouTube video"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] rounded-xl text-xs font-semibold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-all cursor-pointer disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              Try 1-Click Demo
            </button>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                role="alert"
                aria-live="assertive"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex items-center justify-between gap-3 bg-red-500/10 border border-red-500/30 backdrop-blur-md text-red-200 text-sm rounded-xl px-4 py-3.5"
              >
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                  <span>{error}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  aria-label="Dismiss error notification"
                  className="text-red-400 hover:text-red-200 p-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {loading && (
          <SpotlightCard spotlightColor={theme.spotlightRgba} className="p-6 space-y-6 animate-pulse">
            <div className="flex flex-col sm:flex-row gap-6">
              <div className="w-full sm:w-64 aspect-video bg-white/5 rounded-xl shrink-0" />
              <div className="flex-1 space-y-4 py-1">
                <div className="h-4 bg-white/10 rounded-full w-28" />
                <div className="h-6 bg-white/10 rounded-lg w-4/5" />
                <div className="h-4 bg-white/5 rounded-lg w-1/3" />
                <div className="h-10 bg-white/10 rounded-xl w-56 mt-4" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="h-20 bg-white/5 rounded-xl" />
              <div className="h-20 bg-white/5 rounded-xl" />
              <div className="h-20 bg-white/5 rounded-xl" />
              <div className="h-20 bg-white/5 rounded-xl" />
            </div>
          </SpotlightCard>
        )}

        <AnimatePresence mode="wait">
          {media && !loading && (
            <motion.div
              key={media.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-5"
            >
              <SpotlightCard spotlightColor={theme.spotlightRgba} className="p-5 sm:p-6">
                <div className="flex flex-col md:flex-row gap-6 items-start">
                  <div className="relative w-full md:w-64 aspect-video rounded-xl overflow-hidden bg-zinc-950 border border-white/10 shrink-0 group shadow-2xl">
                    {media.thumbnail ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={media.thumbnail}
                        alt={`Thumbnail preview for ${media.title}`}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-600">
                        <Tv className="w-10 h-10" />
                      </div>
                    )}
                    {media.duration > 0 && (
                      <span className="absolute bottom-2.5 right-2.5 bg-black/80 backdrop-blur-md text-white text-xs font-mono px-2.5 py-0.5 rounded-md border border-white/10">
                        {formatDuration(media.duration)}
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col justify-between space-y-4 w-full">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${theme.pillClasses}`}
                        >
                          {PLATFORM_THEMES[media.platform].name.replace(' Engine', '')}
                        </span>
                        <span className="text-xs text-zinc-400 font-medium truncate">
                          by {media.uploader}
                        </span>
                      </div>

                      <h2 className="text-lg sm:text-xl font-bold text-white line-clamp-2 leading-snug">
                        {media.title}
                      </h2>
                    </div>

                    <div
                      role="tablist"
                      aria-label="Media format categories"
                      className="inline-flex p-1 rounded-xl bg-zinc-950/90 border border-white/10 w-fit"
                    >
                      {(['video', 'audio'] as const).map((tab) => {
                        const isActive = activeTab === tab;
                        return (
                          <button
                            key={tab}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            onClick={() => setActiveTab(tab)}
                            className={`relative inline-flex items-center gap-2 px-5 py-2 min-h-[38px] rounded-lg text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 transition-colors cursor-pointer ${
                              isActive ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            {isActive && (
                              <motion.div
                                layoutId="activeMediaTab"
                                transition={{ type: 'spring', bounce: 0.2, duration: 0.45 }}
                                className={`absolute inset-0 rounded-lg bg-gradient-to-r ${theme.buttonClasses}`}
                              />
                            )}
                            <span className="relative z-10 inline-flex items-center gap-2">
                              {tab === 'video' ? (
                                <>
                                  <Film className="w-3.5 h-3.5" />
                                  Video Formats (MP4)
                                </>
                              ) : (
                                <>
                                  <Music className="w-3.5 h-3.5" />
                                  Audio Extraction (MP3)
                                </>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <AnimatePresence>
                  {jobProgress && activeFormatId && (
                    <motion.div
                      role="status"
                      aria-live="polite"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-6 pt-5 border-t border-white/10 space-y-2.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-200 font-medium flex items-center gap-2">
                          {jobProgress.status === 'ready' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                          )}
                          {jobProgress.status === 'starting' && 'Initializing extraction pipeline...'}
                          {jobProgress.status === 'downloading' &&
                            'Downloading high-bitrate stream tracks...'}
                          {jobProgress.status === 'merging' &&
                            'Muxing video & audio with FFmpeg...'}
                          {jobProgress.status === 'ready' && 'Stream complete — saving file!'}
                        </span>
                        <span className="font-mono font-semibold text-emerald-400">
                          {jobProgress.percent}%
                        </span>
                      </div>

                      <div className="w-full h-2.5 bg-zinc-950 rounded-full overflow-hidden border border-white/10 p-0.5">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${jobProgress.percent}%` }}
                          transition={{ ease: 'easeOut', duration: 0.3 }}
                          className={`h-full rounded-full bg-gradient-to-r ${theme.buttonClasses}`}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </SpotlightCard>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {filteredFormats.map((format, idx) => {
                  const sizeText = formatBytes(format.filesizeApprox);
                  const isProcessing = activeFormatId === format.formatId;

                  return (
                    <motion.div
                      key={format.formatId}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                    >
                      <SpotlightCard
                        as="button"
                        type="button"
                        disabled={Boolean(activeFormatId)}
                        spotlightColor={theme.spotlightRgba}
                        onClick={() => !activeFormatId && handleDownloadClick(format)}
                        aria-label={`Download ${format.label} ${format.ext.toUpperCase()}${sizeText ? `, approx ${sizeText}` : ''}`}
                        className={`w-full p-4 cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:opacity-50 disabled:pointer-events-none ${
                          activeFormatId && !isProcessing ? 'opacity-50 pointer-events-none' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm sm:text-base font-bold text-white group-hover:text-emerald-300 transition-colors">
                                {format.label}
                              </span>
                              {!format.needsMerge ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                  <Zap className="w-3 h-3" />
                                  Instant
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/5 text-zinc-300 border border-white/10">
                                  HD Mux
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-zinc-400">
                              {format.ext.toUpperCase()}
                              {sizeText ? ` • ~${sizeText}` : ''}
                              {format.needsMerge
                                ? ' • FFmpeg Studio Merge'
                                : ' • Direct Zero-Disk Stream'}
                            </p>
                          </div>

                          <div
                            className={`w-10 h-10 rounded-xl bg-white/5 border border-white/10 group-hover:border-transparent group-hover:bg-gradient-to-br ${theme.buttonClasses} flex items-center justify-center text-zinc-300 group-hover:text-white transition-all duration-300 shrink-0 shadow-inner`}
                          >
                            {isProcessing ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <ArrowDownToLine className="w-4 h-4 group-hover:translate-y-0.5 transition-transform" />
                            )}
                          </div>
                        </div>
                      </SpotlightCard>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <DownloadHistory
          items={history}
          activeUrl={url}
          isLoading={loading}
          onSelect={(selectedUrl) => {
            handleUrlChange(selectedUrl);
            fetchMediaInfo(selectedUrl);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onRemove={(id) => setHistory(removeHistoryItem(id))}
          onClearAll={() => {
            clearAllHistory();
            setHistory([]);
          }}
        />
      </div>
    </div>
  );
}
