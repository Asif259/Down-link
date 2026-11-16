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
import DownloadHistory from './DownloadHistory';
import DownlinkLogo, { LogoActivityState } from './DownlinkLogo';
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

const PLATFORM_PRESETS: Array<{
  platform: SupportedPlatform;
  label: string;
  tag: string;
  placeholder: string;
}> = [
  {
    platform: 'youtube',
    label: 'YouTube',
    tag: '1080p & MP3',
    placeholder: 'https://www.youtube.com/watch?v=…',
  },
  {
    platform: 'tiktok',
    label: 'TikTok',
    tag: 'No watermark',
    placeholder: 'https://www.tiktok.com/@user/video/…',
  },
  {
    platform: 'instagram',
    label: 'Instagram',
    tag: 'Reels & audio',
    placeholder: 'https://www.instagram.com/reel/…',
  },
  {
    platform: 'facebook',
    label: 'Facebook',
    tag: 'Watch & video',
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
      setError('Please provide a valid media URL');
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
        throw new Error(data.message || data.error || 'Failed to extract media information');
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
        err instanceof Error ? err.message : 'An unexpected error occurred';
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
        setError('Clipboard access not supported in this browser');
        return;
      }
      const clipText = await navigator.clipboard.readText();
      if (!clipText.trim()) {
        setError('Clipboard is empty');
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
          setError(payload.message || 'Media conversion process failed');
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
        // Zero-disk Direct CDN stream proxy for instant mobile / single-stream formats
        setActiveFormatId(null);
        triggerBrowserDownload(
          `${API_BASE_URL}/api/media/stream/${format.streamToken}`
        );
        return;
      }

      // High-res DASH or MP3 audio conversion via server FFmpeg
      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setJobProgress({ status: 'starting', percent: 5, message: 'Starting extraction' });
      listenToJobProgress(jobId);

      const downloadUrl = `${API_BASE_URL}/api/media/download?url=${encodeURIComponent(
        url.trim()
      )}&formatId=${encodeURIComponent(format.formatId)}&type=${format.type}&jobId=${jobId}`;

      triggerBrowserDownload(downloadUrl);
    } catch (err: unknown) {
      setActiveFormatId(null);
      setJobProgress(null);
      const message =
        err instanceof Error ? err.message : 'Could not initialize download';
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

  const isBusy = loading || Boolean(activeFormatId);
  const logoActivity: LogoActivityState = loading
    ? 'extracting'
    : jobProgress?.status === 'ready'
    ? 'ready'
    : activeFormatId || jobProgress?.status === 'downloading' || jobProgress?.status === 'merging'
    ? 'downloading'
    : 'idle';

  return (
    <div className="min-h-screen w-full bg-[var(--color-paper)] text-[var(--color-ink)] selection:bg-[var(--color-accent)]/20 selection:text-[var(--color-ink)]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16 space-y-8">
        
        {/* Top Header Bar */}
        <header className="flex items-center justify-between pb-6 border-b border-[var(--color-rule)]">
          <DownlinkLogo
            platform={media?.platform || detectedPlatform}
            activity={logoActivity}
            progress={jobProgress?.percent || 0}
          />

          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-paper-2)] border border-[var(--color-rule)] text-xs font-mono text-[var(--color-muted)]">
            <span className="hidden sm:inline">YouTube • TikTok • Instagram • Facebook</span>
            <span className="sm:hidden text-[10px]">YouTube • TikTok • IG • FB</span>
          </div>
        </header>

        {/* Hero Title & Description */}
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-[var(--color-ink)]">
            Universal media extractor
          </h1>
          <p className="text-sm text-[var(--color-secondary)] text-[var(--color-ink-2)] max-w-xl">
            Extract and download media streams from YouTube, TikTok, Instagram, and Facebook in high-definition video or audio.
          </p>
        </div>

        {/* Primary Extraction Input Deck */}
        <section className="space-y-3" aria-label="Media extraction console">
          <div className="rounded-[var(--radius-card)] bg-[var(--color-paper-2)] border border-[var(--color-rule)] focus-within:border-[var(--color-rule-2)] transition-colors p-1.5 sm:p-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                fetchMediaInfo(url);
              }}
              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
            >
              <div className="relative flex-1 flex items-center">
                <input
                  id="media-url-input"
                  aria-label="Media URL from YouTube, TikTok, Instagram, or Facebook"
                  type="url"
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  onPaste={handlePaste}
                  placeholder={
                    PLATFORM_PRESETS.find((p) => p.platform === detectedPlatform)?.placeholder ||
                    'Paste video or audio link'
                  }
                  className="w-full bg-transparent px-3 py-2.5 sm:py-3 text-sm text-[var(--color-ink)] placeholder-[var(--color-muted)] focus:outline-none font-sans"
                  required
                />

                {url ? (
                  <button
                    type="button"
                    onClick={() => {
                      setUrl('');
                      setDetectedPlatform('unknown');
                      setMedia(null);
                      setError(null);
                    }}
                    aria-label="Clear input"
                    className="p-1.5 mr-1 text-[var(--color-muted)] hover:text-[var(--color-ink)] rounded-[var(--radius-sm)] hover:bg-[var(--color-paper-3)] transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleClipboardButton}
                    aria-label="Paste from clipboard"
                    className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1 mr-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)] rounded-[var(--radius-sm)] hover:bg-[var(--color-paper-3)] transition-colors cursor-pointer"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" />
                    <span>Paste</span>
                    <kbd className="px-1 py-0.2 text-[10px] font-mono bg-[var(--color-paper-3)] border border-[var(--color-rule)] rounded text-[var(--color-muted)]">
                      ⌘V
                    </kbd>
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || !url.trim()}
                aria-label={loading ? 'Extracting media streams' : 'Extract media streams'}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 sm:py-2.5 text-xs font-semibold rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-accent-ink)] hover:opacity-95 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer whitespace-nowrap min-h-[40px] sm:min-h-[38px]"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Extracting</span>
                  </>
                ) : (
                  <>
                    <ArrowDownToLine className="w-4 h-4" />
                    <span>Extract</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Platform Presets & Quick Sample Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              {PLATFORM_PRESETS.map((item) => {
                const isSelected =
                  (media?.platform || detectedPlatform) === item.platform;
                return (
                  <button
                    key={item.platform}
                    type="button"
                    onClick={() => setDetectedPlatform(item.platform)}
                    aria-pressed={isSelected}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer border ${
                      isSelected
                        ? 'bg-[var(--color-paper-3)] border-[var(--color-rule-2)] text-[var(--color-ink)]'
                        : 'bg-[var(--color-paper-2)] border-[var(--color-rule)] text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:border-[var(--color-rule-2)]'
                    }`}
                  >
                    <span>{item.label}</span>
                    <span className="font-mono text-[10px] text-[var(--color-muted)]">
                      {item.tag}
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
              className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline cursor-pointer disabled:opacity-50 py-1"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Try sample link</span>
            </button>
          </div>

          {/* Error Message Notice */}
          <AnimatePresence>
            {error && (
              <motion.div
                role="alert"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="flex items-center justify-between gap-3 bg-[var(--color-paper-2)] border border-[var(--color-error)] text-[var(--color-ink)] text-xs rounded-[var(--radius-md)] px-3.5 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-[var(--color-error)] shrink-0" />
                  <span>{error}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  aria-label="Dismiss error notification"
                  className="text-[var(--color-muted)] hover:text-[var(--color-ink)] p-1 rounded hover:bg-[var(--color-paper-3)] transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Loading Skeleton */}
        {loading && (
          <div className="p-5 space-y-5 rounded-[var(--radius-card)] border border-[var(--color-rule)] bg-[var(--color-paper-2)]">
            <div className="flex flex-col sm:flex-row gap-5 items-start">
              <div className="w-full sm:w-56 aspect-video bg-[var(--color-paper-3)] rounded-[8px] shrink-0" />
              <div className="flex-1 space-y-3 w-full py-1">
                <div className="h-3.5 bg-[var(--color-paper-3)] rounded w-24" />
                <div className="h-5 bg-[var(--color-paper-3)] rounded w-4/5" />
                <div className="h-3.5 bg-[var(--color-paper-3)] rounded w-1/3" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="h-16 bg-[var(--color-paper-3)] rounded-[var(--radius-md)]" />
              <div className="h-16 bg-[var(--color-paper-3)] rounded-[var(--radius-md)]" />
            </div>
          </div>
        )}

        {/* Media Inspector & Stream Selection */}
        <AnimatePresence mode="wait">
          {media && !loading && (
            <motion.div
              key={media.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-4"
            >
              {/* Main Media Metadata Card */}
              <div className="p-4 sm:p-5 rounded-[var(--radius-card)] border border-[var(--color-rule)] bg-[var(--color-paper-2)] space-y-4">
                <div className="flex flex-col sm:flex-row gap-4 sm:gap-5 items-start">
                  <div className="relative w-full sm:w-56 aspect-video rounded-[8px] overflow-hidden bg-[var(--color-paper)] border border-[var(--color-rule)] shrink-0">
                    {media.thumbnail ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={media.thumbnail}
                        alt=""
                        fetchPriority="high"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[var(--color-muted)]">
                        <Tv className="w-8 h-8" />
                      </div>
                    )}
                    {media.duration > 0 && (
                      <span className="absolute bottom-1.5 right-1.5 bg-[#141415]/90 text-[var(--color-ink)] text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded-[4px] border border-[var(--color-rule)]">
                        {formatDuration(media.duration)}
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col justify-between space-y-3 w-full">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded-[4px] text-[10px] font-mono text-[var(--color-ink-2)] bg-[var(--color-paper-3)] border border-[var(--color-rule)] uppercase">
                          {media.platform}
                        </span>
                        <span className="text-xs text-[var(--color-muted)] truncate">
                          {media.uploader}
                        </span>
                      </div>

                      <h2
                        className="text-base font-medium text-[var(--color-ink)] line-clamp-2 leading-snug"
                        title={media.title}
                      >
                        {media.title}
                      </h2>
                    </div>

                    {/* Format Category Switcher Tabs */}
                    <div
                      role="tablist"
                      aria-label="Format category"
                      className="inline-flex p-0.5 rounded-[var(--radius-md)] bg-[var(--color-paper-3)] border border-[var(--color-rule)] w-fit"
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
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors cursor-pointer ${
                              isActive
                                ? 'bg-[var(--color-paper)] text-[var(--color-ink)] shadow-sm'
                                : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                            }`}
                          >
                            {tab === 'video' ? (
                              <>
                                <Film className="w-3.5 h-3.5" />
                                <span>Video (MP4)</span>
                              </>
                            ) : (
                              <>
                                <Music className="w-3.5 h-3.5" />
                                <span>Audio (MP3)</span>
                              </>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Tactile Segmented Broadcast Level Progress Bar */}
                <AnimatePresence>
                  {jobProgress && activeFormatId && (
                    <motion.div
                      role="status"
                      aria-live="polite"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="pt-3 border-t border-[var(--color-rule)] space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--color-ink-2)] font-medium flex items-center gap-2">
                          {jobProgress.status === 'ready' ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-success)]" />
                          ) : (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-accent)]" />
                          )}
                          {jobProgress.status === 'starting' && 'Initializing stream extraction'}
                          {jobProgress.status === 'downloading' && 'Downloading stream tracks'}
                          {jobProgress.status === 'merging' && 'Muxing container with FFmpeg'}
                          {jobProgress.status === 'ready' && 'Stream complete — saving file'}
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
                        aria-label="Conversion progress"
                        className="w-full h-2 bg-[var(--color-paper-3)] rounded-[4px] overflow-hidden border border-[var(--color-rule)] p-0.5"
                      >
                        <div
                          style={{ width: `${jobProgress.percent}%` }}
                          className="h-full rounded-[2px] bg-[var(--color-accent)] transition-all duration-200"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Format Options Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filteredFormats.map((format) => {
                  const sizeText = formatBytes(format.filesizeApprox);
                  const isProcessing = activeFormatId === format.formatId;

                  return (
                    <button
                      key={format.formatId}
                      type="button"
                      disabled={Boolean(activeFormatId)}
                      onClick={() => !activeFormatId && handleDownloadClick(format)}
                      aria-label={`Download ${format.label} ${format.ext.toUpperCase()}${
                        sizeText ? `, approx ${sizeText}` : ''
                      }`}
                      className={`w-full p-3.5 rounded-[var(--radius-card)] border bg-[var(--color-paper-2)] text-left transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                        isProcessing
                          ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]'
                          : 'border-[var(--color-rule)] hover:border-[var(--color-rule-2)] hover:bg-[var(--color-paper-3)]/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-semibold text-[var(--color-ink)] truncate">
                              {format.label}
                            </span>
                            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-[var(--color-paper-3)] text-[var(--color-ink-2)] border border-[var(--color-rule)]">
                              {format.ext.toUpperCase()}
                            </span>
                            {!format.needsMerge ? (
                              <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-[var(--color-paper-3)] text-[var(--color-accent)] border border-[var(--color-rule)]">
                                Direct stream
                              </span>
                            ) : (
                              <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-[var(--color-paper-3)] text-[var(--color-muted)] border border-[var(--color-rule)]">
                                Muxed
                              </span>
                            )}
                          </div>

                          <div className="text-xs font-mono text-[var(--color-muted)] flex items-center gap-1.5">
                            {sizeText && (
                              <>
                                <span>~{sizeText}</span>
                                <span>·</span>
                              </>
                            )}
                            <span>{format.needsMerge ? 'FFmpeg merge' : 'Instant CDN'}</span>
                          </div>
                        </div>

                        <div className="w-8 h-8 rounded-[var(--radius-sm)] bg-[var(--color-paper-3)] border border-[var(--color-rule)] flex items-center justify-center text-[var(--color-ink-2)] shrink-0">
                          {isProcessing ? (
                            <Loader2 className="w-4 h-4 animate-spin text-[var(--color-accent)]" />
                          ) : (
                            <ArrowDownToLine className="w-4 h-4" />
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* History Deck */}
        <DownloadHistory
          items={history}
          activeUrl={url}
          isLoading={loading}
          onSelect={handleSelectHistory}
          onRemove={handleRemoveHistory}
          onClearAll={handleClearAllHistory}
        />

        {/* Studio Console Footer */}
        <footer className="pt-6 border-t border-[var(--color-rule)] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[var(--color-muted)]">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
            <span className="font-medium text-[var(--color-ink-2)]">
              Down-link Stream Engine
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px] font-mono text-[var(--color-muted)]">
            <span>Direct stream & FFmpeg container muxing</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
