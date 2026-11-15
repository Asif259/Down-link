'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowDownToLine,
  CheckCircle2,
  ClipboardPaste,
  Film,
  Loader2,
  Music,
  Tv,
  X,
  Zap,
} from 'lucide-react';
import Aurora from './react-bits/Aurora';
import Magnet from './react-bits/Magnet';
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
    name: 'youtube engine',
    accentHex: '#ef4444',
    spotlightRgba: 'rgba(239, 68, 68, 0.16)',
    auroraStops: ['#5c1a24', '#8f6f30', '#1c1024'],
    pillClasses: 'bg-[var(--color-paper-2)] text-[var(--color-accent-2)] border-[var(--color-rule-2)]',
    buttonClasses: 'bg-[var(--color-accent)] text-[var(--color-accent-ink)]',
  },
  facebook: {
    name: 'facebook engine',
    accentHex: '#3b82f6',
    spotlightRgba: 'rgba(59, 130, 246, 0.16)',
    auroraStops: ['#1d3b66', '#8f6f30', '#1c1024'],
    pillClasses: 'bg-[var(--color-paper-2)] text-[var(--color-ink-2)] border-[var(--color-rule-2)]',
    buttonClasses: 'bg-[var(--color-accent)] text-[var(--color-accent-ink)]',
  },
  instagram: {
    name: 'instagram engine',
    accentHex: '#ec4899',
    spotlightRgba: 'rgba(236, 72, 153, 0.16)',
    auroraStops: ['#661e44', '#8f6f30', '#1c1024'],
    pillClasses: 'bg-[var(--color-paper-2)] text-[var(--color-accent-2)] border-[var(--color-rule-2)]',
    buttonClasses: 'bg-[var(--color-accent)] text-[var(--color-accent-ink)]',
  },
  tiktok: {
    name: 'tiktok engine',
    accentHex: '#06b6d4',
    spotlightRgba: 'rgba(6, 182, 212, 0.16)',
    auroraStops: ['#164a57', '#8f6f30', '#1c1024'],
    pillClasses: 'bg-[var(--color-paper-2)] text-[var(--color-accent)] border-[var(--color-rule-2)]',
    buttonClasses: 'bg-[var(--color-accent)] text-[var(--color-accent-ink)]',
  },
  unknown: {
    name: 'universal extractor',
    accentHex: '#e2b659',
    spotlightRgba: 'rgba(226, 182, 89, 0.16)',
    auroraStops: ['#2e153b', '#8f6f30', '#1c1024'],
    pillClasses: 'bg-[var(--color-paper-2)] text-[var(--color-accent)] border-[var(--color-rule-2)]',
    buttonClasses: 'bg-[var(--color-accent)] text-[var(--color-accent-ink)]',
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
    label: 'youtube',
    tag: '1080p hd & mp3',
    dotColor: '#ef4444',
    placeholder: 'https://www.youtube.com/watch?v=…',
  },
  {
    platform: 'tiktok',
    label: 'tiktok',
    tag: 'no watermark',
    dotColor: '#06b6d4',
    placeholder: 'https://www.tiktok.com/@user/video/…',
  },
  {
    platform: 'instagram',
    label: 'instagram',
    tag: 'reels & audio',
    dotColor: '#ec4899',
    placeholder: 'https://www.instagram.com/reel/…',
  },
  {
    platform: 'facebook',
    label: 'facebook',
    tag: 'hd watch',
    dotColor: '#3b82f6',
    placeholder: 'https://www.facebook.com/watch/?v=…',
  },
];

const DEMO_SAMPLE_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

export default function MediaDownloader() {
  const [url, setUrl] = useState('');
  const [detectedPlatform, setDetectedPlatform] =
    useState<SupportedPlatform>('unknown');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaInfoResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'video' | 'audio'>('video');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeFormatId, setActiveFormatId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isFetchingRef = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory(loadHistory());
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const theme = useMemo(() => {
    const key = media?.platform || detectedPlatform;
    return PLATFORM_THEMES[key] || PLATFORM_THEMES.unknown;
  }, [media?.platform, detectedPlatform]);

  const handleUrlChange = useCallback((value: string) => {
    const cleaned = cleanUrlInput(value);
    setUrl(cleaned);
    setDetectedPlatform(detectClientPlatform(cleaned));
    if (!cleaned) {
      setMedia(null);
      setError(null);
    }
  }, []);

  const fetchMediaInfo = useCallback(async (targetUrl: string) => {
    const trimmed = targetUrl.trim();
    if (!trimmed) {
      setError('Please provide a valid media URL.');
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);
    setMedia(null);
    setActiveFormatId(null);
    setJobProgress(null);
    isFetchingRef.current = true;

    try {
      const res = await fetch(`${API_BASE_URL}/api/media/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
        signal: controller.signal,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to extract media information.');
      }

      setMedia(data);
      setDetectedPlatform(data.platform);

      const hasVideo = data.formats.some((f: CleanFormat) => f.type === 'video');
      const hasAudio = data.formats.some((f: CleanFormat) => f.type === 'audio');
      if (!hasVideo && hasAudio) {
        setActiveTab('audio');
      } else {
        setActiveTab('video');
      }

      const updatedHistory = saveHistoryItem({
        url: trimmed,
        title: data.title,
        thumbnail: data.thumbnail,
        duration: data.duration,
        platform: data.platform,
        uploader: data.uploader,
      });
      setHistory(updatedHistory);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const message =
        err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(message);
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData('text');
      const cleaned = cleanUrlInput(pasted);
      setUrl(cleaned);
      setDetectedPlatform(detectClientPlatform(cleaned));
      if (cleaned) {
        fetchMediaInfo(cleaned);
      }
    },
    [fetchMediaInfo]
  );

  const handleClipboardButton = useCallback(async () => {
    try {
      if (!navigator.clipboard?.readText) {
        setError('Clipboard access not supported in this browser.');
        return;
      }
      const clipText = await navigator.clipboard.readText();
      if (!clipText.trim()) {
        setError('Clipboard is empty.');
        return;
      }
      const cleaned = cleanUrlInput(clipText);
      handleUrlChange(cleaned);
      fetchMediaInfo(cleaned);
    } catch {
      setError('Clipboard permission denied. Please paste manually.');
    }
  }, [handleUrlChange, fetchMediaInfo]);

  const listenToJobProgress = (jobId: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`${API_BASE_URL}/api/media/progress/${jobId}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const payload: JobProgress = JSON.parse(event.data);
        setJobProgress(payload);

        if (payload.status === 'ready') {
          es.close();
          eventSourceRef.current = null;
          setActiveFormatId(null);
        } else if (payload.status === 'error') {
          es.close();
          eventSourceRef.current = null;
          setActiveFormatId(null);
          setError(payload.message || 'Media conversion process failed.');
        }
      } catch {
        // Ignore unparseable frames
      }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      setActiveFormatId(null);
    };
  };

  const triggerBrowserDownload = (downloadUrl: string) => {
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.setAttribute('download', '');
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadClick = async (format: CleanFormat) => {
    if (!media) return;
    setError(null);
    setActiveFormatId(format.formatId);
    setJobProgress(null);

    try {
      if (!format.needsMerge && format.streamToken) {
        // Zero-disk Direct CDN stream proxy for instant mobile / 360p formats
        setActiveFormatId(null);
        triggerBrowserDownload(
          `${API_BASE_URL}/api/media/stream/${format.streamToken}`
        );
        return;
      }

      // High-res DASH or MP3 audio conversion via server FFmpeg
      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setJobProgress({ status: 'starting', percent: 5, message: 'Starting download...' });
      listenToJobProgress(jobId);

      const downloadUrl = `${API_BASE_URL}/api/media/download?url=${encodeURIComponent(
        url.trim()
      )}&formatId=${encodeURIComponent(format.formatId)}&type=${format.type}&jobId=${jobId}`;

      triggerBrowserDownload(downloadUrl);
    } catch (err: unknown) {
      setActiveFormatId(null);
      setJobProgress(null);
      const message =
        err instanceof Error ? err.message : 'Could not initialize download.';
      setError(message);
    }
  };

  const filteredFormats = useMemo(() => {
    if (!media) return [];
    return media.formats.filter((f) => f.type === activeTab);
  }, [media, activeTab]);

  const handleSelectHistory = useCallback(
    (selectedUrl: string) => {
      const cleaned = cleanUrlInput(selectedUrl);
      setUrl(cleaned);
      setDetectedPlatform(detectClientPlatform(cleaned));
      fetchMediaInfo(cleaned);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [fetchMediaInfo]
  );

  const handleRemoveHistory = useCallback((id: string) => {
    setHistory(removeHistoryItem(id));
  }, []);

  const handleClearAllHistory = useCallback(() => {
    clearAllHistory();
    setHistory([]);
  }, []);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[var(--color-paper)] text-[var(--color-ink)] selection:bg-[var(--color-accent)]/20 selection:text-[var(--color-ink)]">
      <Aurora colorStops={theme.auroraStops} speed={0.7} amplitude={1.2} />

      <div className="pointer-events-none absolute inset-0 lumen-grid-overlay" />

      <div className="relative z-10 max-w-4xl mx-auto px-3.5 sm:px-6 pt-10 sm:pt-16 pb-16 sm:pb-24 space-y-8 sm:space-y-10">
        <header className="text-center space-y-4 sm:space-y-5 max-w-2xl mx-auto">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="font-display text-3xl sm:text-5xl md:text-6xl tracking-[var(--tracking-display)] text-[var(--color-ink)] font-normal leading-[1.08] mx-auto"
          >
            Download media from any platform in seconds<span className="text-[var(--color-accent-2)]">.</span>
          </motion.h1>

          <p className="text-sm sm:text-base text-[var(--color-muted)] max-w-xl mx-auto leading-relaxed">
            Paste a link from{' '}
            <span className="text-[var(--color-ink)] font-medium">YouTube</span>,{' '}
            <span className="text-[var(--color-ink)] font-medium">Facebook</span>,{' '}
            <span className="text-[var(--color-ink)] font-medium">Instagram</span>, or{' '}
            <span className="text-[var(--color-ink)] font-medium">TikTok</span>. Automatically detects
            streams and delivers crisp MP4 video or studio-grade MP3 audio.
          </p>
        </header>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-pill)] text-xs font-semibold border transition-colors duration-300 ${theme.pillClasses}`}
              >
                <span
                  className="w-2 h-2 rounded-[var(--radius-pill)] motion-safe:animate-pulse motion-reduce:animate-none shrink-0"
                  style={{ backgroundColor: theme.accentHex }}
                />
                {theme.name}
              </span>
            </div>

            <button
              type="button"
              onClick={handleClipboardButton}
              aria-label="Paste URL from clipboard"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-2)] hover:text-[var(--color-ink)] active:bg-[var(--color-paper-3)] bg-[var(--color-paper-2)] hover:bg-[var(--color-paper-3)] border border-[var(--color-rule)] px-3 py-1.5 min-h-[36px] sm:min-h-0 rounded-[var(--radius-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] transition-colors cursor-pointer"
            >
              <ClipboardPaste className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
              Paste from Clipboard
            </button>
          </div>

          <StarBorder color={theme.accentHex}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                fetchMediaInfo(url);
              }}
              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2 sm:p-2.5"
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
                    'https://www.youtube.com/watch?v=… or TikTok / Reel link'
                  }
                  className="w-full bg-transparent pl-3.5 sm:pl-4 pr-11 py-3 sm:py-3.5 text-base text-[var(--color-ink)] placeholder-[var(--color-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/50 rounded-[var(--radius-card)]"
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
                    className="absolute right-2 sm:right-3 p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-[var(--radius-card)] text-[var(--color-muted)] hover:text-[var(--color-ink)] active:text-[var(--color-ink)] hover:bg-[var(--color-paper-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <Magnet strength={0.18} disabled={loading || !url.trim()} className="w-full sm:w-auto">
                <button
                  type="submit"
                  disabled={loading || !url.trim()}
                  aria-label={loading ? 'Extracting media streams…' : 'Extract media streams'}
                  className={`w-full sm:w-auto inline-flex items-center justify-center gap-2.5 ${theme.buttonClasses} hover:opacity-95 active:opacity-90 disabled:bg-[var(--color-paper-3)] disabled:text-[var(--color-muted)] disabled:shadow-none font-semibold text-sm px-6 sm:px-7 py-3.5 min-h-[48px] rounded-[var(--radius-pill)] shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-paper)] transition-colors cursor-pointer whitespace-nowrap`}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Extracting…</span>
                    </>
                  ) : (
                    <>
                      <ArrowDownToLine className="w-4 h-4" />
                      <span>Extract</span>
                    </>
                  )}
                </button>
              </Magnet>
            </form>
          </StarBorder>

          <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-1">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
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
                    className={`group inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-2 min-h-[40px] sm:min-h-[38px] rounded-[var(--radius-pill)] text-xs font-medium border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-paper)] transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--color-paper-3)] border-[var(--color-accent)] text-[var(--color-ink)] shadow-sm'
                        : 'bg-[var(--color-paper-2)] border-[var(--color-rule)] text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-paper-3)]'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-[var(--radius-pill)] shrink-0"
                      style={{ backgroundColor: item.dotColor }}
                    />
                    <span className="font-semibold text-[var(--color-ink)]">{item.label}</span>
                    <span className="text-[11px] text-[var(--color-muted)] hidden md:inline font-mono">
                      / {item.tag}
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
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[40px] sm:min-h-[38px] rounded-[var(--radius-pill)] text-xs font-semibold bg-[var(--color-paper-2)] hover:bg-[var(--color-paper-3)] active:bg-[var(--color-paper)] text-[var(--color-accent)] border border-[var(--color-rule-2)] hover:border-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-paper)] transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              <Zap className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
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
                className="flex items-center justify-between gap-3 bg-[var(--color-paper-2)] border border-[var(--color-error)] text-[var(--color-ink)] text-sm rounded-[var(--radius-card)] px-4 py-3.5"
              >
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-4 h-4 shrink-0 text-[var(--color-error)]" />
                  <span>{error}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  aria-label="Dismiss error notification"
                  className="text-[var(--color-muted)] hover:text-[var(--color-ink)] p-1 rounded-[var(--radius-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] cursor-pointer transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {loading && (
          <SpotlightCard spotlightColor={theme.spotlightRgba} className="p-6 space-y-6 motion-safe:animate-pulse motion-reduce:animate-none border border-[var(--color-rule)] bg-[var(--color-paper-2)] rounded-[var(--radius-card)]">
            <div className="flex flex-col sm:flex-row gap-6">
              <div className="w-full sm:w-64 aspect-video bg-[var(--color-paper-3)] rounded-[var(--radius-card)] shrink-0" />
              <div className="flex-1 space-y-4 py-1">
                <div className="h-4 bg-[var(--color-paper-3)] rounded-[var(--radius-pill)] w-28" />
                <div className="h-6 bg-[var(--color-paper-3)] rounded-[var(--radius-card)] w-4/5" />
                <div className="h-4 bg-[var(--color-paper-3)] rounded-[var(--radius-card)] w-1/3" />
                <div className="h-10 bg-[var(--color-paper-3)] rounded-[var(--radius-card)] w-56 mt-4" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="h-20 bg-[var(--color-paper-3)] rounded-[var(--radius-card)]" />
              <div className="h-20 bg-[var(--color-paper-3)] rounded-[var(--radius-card)]" />
              <div className="h-20 bg-[var(--color-paper-3)] rounded-[var(--radius-card)]" />
              <div className="h-20 bg-[var(--color-paper-3)] rounded-[var(--radius-card)]" />
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
              <SpotlightCard
                spotlightColor={theme.spotlightRgba}
                className="p-4 sm:p-6 border border-[var(--color-rule)] bg-[var(--color-paper-2)] rounded-[var(--radius-card)]"
              >
                <div className="flex flex-col md:flex-row gap-5 sm:gap-6 items-start">
                  <div className="relative w-full md:w-64 aspect-video rounded-[var(--radius-card)] overflow-hidden bg-[var(--color-paper)] border border-[var(--color-rule)] shrink-0 group">
                    {media.thumbnail ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={media.thumbnail}
                        alt={`Thumbnail preview for ${media.title}`}
                        fetchPriority="high"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[var(--color-muted)]">
                        <Tv className="w-10 h-10" />
                      </div>
                    )}
                    {media.duration > 0 && (
                      <span className="absolute bottom-2.5 right-2.5 bg-[var(--color-paper)] text-[var(--color-ink)] text-xs font-mono tabular-nums px-2.5 py-0.5 rounded-[var(--radius-card)] border border-[var(--color-rule)]">
                        {formatDuration(media.duration)}
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col justify-between space-y-4 w-full">
                    <div className="space-y-2 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`px-2.5 py-0.5 rounded-[var(--radius-pill)] text-xs font-semibold border ${theme.pillClasses}`}
                        >
                          {PLATFORM_THEMES[media.platform].name.replace(' engine', '')}
                        </span>
                        <span className="text-xs text-[var(--color-muted)] font-medium truncate max-w-[200px] sm:max-w-none">
                          by {media.uploader}
                        </span>
                      </div>

                      <h2 className="text-base sm:text-xl font-bold text-[var(--color-ink)] line-clamp-2 leading-snug break-words">
                        {media.title}
                      </h2>
                    </div>

                    <div
                      role="tablist"
                      aria-label="Media format categories"
                      className="grid grid-cols-2 sm:inline-flex p-1 rounded-[var(--radius-pill)] bg-[var(--color-paper)] border border-[var(--color-rule)] w-full sm:w-fit"
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
                            className={`relative inline-flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2.5 sm:py-2 min-h-[44px] sm:min-h-[38px] rounded-[var(--radius-pill)] text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-paper)] transition-colors cursor-pointer ${
                              isActive ? 'text-[var(--color-accent-ink)]' : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                            }`}
                          >
                            {isActive && (
                              <motion.div
                                layoutId="activeMediaTab"
                                transition={{ type: 'spring', bounce: 0.2, duration: 0.45 }}
                                className={`absolute inset-0 rounded-[var(--radius-pill)] ${theme.buttonClasses}`}
                              />
                            )}
                            <span className="relative z-10 inline-flex items-center justify-center gap-1.5 sm:gap-2 truncate">
                              {tab === 'video' ? (
                                <>
                                  <Film className="w-3.5 h-3.5 shrink-0" />
                                  <span className="truncate">Video (MP4)</span>
                                </>
                              ) : (
                                <>
                                  <Music className="w-3.5 h-3.5 shrink-0" />
                                  <span className="truncate">Audio (MP3)</span>
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
                      className="mt-6 pt-5 border-t border-[var(--color-rule)] space-y-2.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--color-ink)] font-medium flex items-center gap-2">
                          {jobProgress.status === 'ready' ? (
                            <CheckCircle2 className="w-4 h-4 text-[var(--color-success)]" />
                          ) : (
                            <Loader2 className="w-4 h-4 animate-spin text-[var(--color-accent)]" />
                          )}
                          {jobProgress.status === 'starting' && 'Initializing extraction pipeline…'}
                          {jobProgress.status === 'downloading' &&
                            'Downloading high-bitrate stream tracks…'}
                          {jobProgress.status === 'merging' &&
                            'Muxing video & audio with FFmpeg…'}
                          {jobProgress.status === 'ready' && 'Stream complete — saving file!'}
                        </span>
                        <span className="font-mono tabular-nums font-semibold text-[var(--color-accent)]">
                          {jobProgress.percent}%
                        </span>
                      </div>

                      <div
                        role="progressbar"
                        aria-valuenow={jobProgress.percent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Media conversion progress"
                        className="w-full h-2.5 bg-[var(--color-paper)] rounded-[var(--radius-pill)] overflow-hidden border border-[var(--color-rule)] p-0.5"
                      >
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${jobProgress.percent}%` }}
                          transition={{ ease: 'easeOut', duration: 0.3 }}
                          className={`h-full rounded-[var(--radius-pill)] ${theme.buttonClasses}`}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </SpotlightCard>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-3.5">
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
                        className={`w-full p-3.5 sm:p-4 min-h-[72px] cursor-pointer group rounded-[var(--radius-card)] border border-[var(--color-rule)] bg-[var(--color-paper-2)] hover:bg-[var(--color-paper-3)] hover:border-[var(--color-rule-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-paper)] active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none transition-colors ${
                          isProcessing
                            ? 'ring-2 ring-[var(--color-accent)] border-[var(--color-accent)] shadow-lg shadow-[var(--color-accent)]/15'
                            : activeFormatId
                            ? 'opacity-50 pointer-events-none'
                            : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 sm:gap-4">
                          <div className="space-y-1 sm:space-y-1.5 min-w-0 text-left">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm sm:text-base font-bold text-[var(--color-ink)] group-hover:text-[var(--color-accent)] transition-colors truncate">
                                {format.label}
                              </span>
                              {!format.needsMerge ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--color-paper)] text-[var(--color-accent)] border border-[var(--color-rule)] shrink-0">
                                  <Zap className="w-3 h-3" />
                                  Instant
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--color-paper)] text-[var(--color-ink-2)] border border-[var(--color-rule)] shrink-0">
                                  HD Mux
                                </span>
                              )}
                            </div>

                            <div className="text-xs text-[var(--color-muted)] truncate flex items-center gap-1.5">
                              <span>{format.ext.toUpperCase()}</span>
                              {sizeText && (
                                <>
                                  <span className="text-[var(--color-rule-2)]">/</span>
                                  <span className="tabular-nums">~{sizeText}</span>
                                </>
                              )}
                              <span className="text-[var(--color-rule-2)]">/</span>
                              <span>
                                {format.needsMerge
                                  ? 'FFmpeg Studio Merge'
                                  : 'Direct Zero-Disk Stream'}
                              </span>
                            </div>
                          </div>

                          <div
                            className="w-11 h-11 sm:w-10 sm:h-10 rounded-[var(--radius-pill)] bg-[var(--color-paper)] border border-[var(--color-rule)] group-hover:border-[var(--color-accent)] group-hover:bg-[var(--color-accent)] flex items-center justify-center text-[var(--color-ink-2)] group-hover:text-[var(--color-accent-ink)] transition-colors duration-300 shrink-0 shadow-inner"
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
          onSelect={handleSelectHistory}
          onRemove={handleRemoveHistory}
          onClearAll={handleClearAllHistory}
        />

        <footer className="pt-6 sm:pt-8 border-t border-[var(--color-rule)] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[var(--color-muted)]">
          <div className="flex items-center gap-2 text-[var(--color-ink-2)]">
            <span className="w-1.5 h-1.5 rounded-[var(--radius-pill)] bg-[var(--color-accent)]" />
            <span className="font-medium">Down-link Stream Engine</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-center sm:text-right">
            <span>zero-watermark CDN streaming</span>
            <span className="text-[var(--color-rule-2)]">/</span>
            <span>no logs</span>
            <span className="text-[var(--color-rule-2)]">/</span>
            <span>high fidelity MP4 & MP3</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
