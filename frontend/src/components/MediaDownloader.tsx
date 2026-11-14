'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardPaste,
  Download,
  Film,
  Loader2,
  Music,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import {
  API_BASE_URL,
  CleanFormat,
  detectClientPlatform,
  formatBytes,
  formatDuration,
  JobProgress,
  MediaInfoResponse,
  SupportedPlatform,
} from '../lib/media';

const PLATFORM_STYLES: Record<
  SupportedPlatform,
  { name: string; badge: string; ring: string }
> = {
  youtube: {
    name: 'YouTube',
    badge: 'bg-red-500/15 text-red-400 border-red-500/30',
    ring: 'focus-within:border-red-500/60',
  },
  facebook: {
    name: 'Facebook',
    badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    ring: 'focus-within:border-blue-500/60',
  },
  instagram: {
    name: 'Instagram',
    badge: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
    ring: 'focus-within:border-pink-500/60',
  },
  tiktok: {
    name: 'TikTok',
    badge: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    ring: 'focus-within:border-cyan-500/60',
  },
  unknown: {
    name: 'Auto-Detect',
    badge: 'bg-slate-800 text-slate-400 border-slate-700',
    ring: 'focus-within:border-emerald-500/60',
  },
};

export default function MediaDownloader() {
  const [url, setUrl] = useState('');
  const [detectedPlatform, setDetectedPlatform] = useState<SupportedPlatform>('unknown');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaInfoResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'video' | 'audio'>('video');

  // Tracks active FFmpeg merge / MP3 conversion job
  const [activeFormatId, setActiveFormatId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const handleUrlChange = (value: string) => {
    setUrl(value);
    setDetectedPlatform(detectClientPlatform(value));
    if (error) setError(null);
  };

  const fetchMediaInfo = async (targetUrl: string) => {
    const cleanUrl = targetUrl.trim();
    if (!cleanUrl) return;

    const platform = detectClientPlatform(cleanUrl);
    setDetectedPlatform(platform);

    if (platform === 'unknown') {
      setError('Please enter a valid YouTube, Facebook, Instagram, or TikTok link.');
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
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong while fetching media.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData('text');
    if (pastedText) {
      handleUrlChange(pastedText);
      fetchMediaInfo(pastedText);
    }
  };

  const handleClipboardButton = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        handleUrlChange(text);
        fetchMediaInfo(text);
      }
    } catch {
      setError('Clipboard access blocked by browser. Paste your link directly into the box.');
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

    // Path 1: Progressive Stream Proxy (Zero Disk / Instant Start)
    if (!format.needsMerge && format.streamToken) {
      triggerBrowserDownload(`${API_BASE_URL}/api/media/stream/${format.streamToken}`);
      return;
    }

    // Path 2: FFmpeg DASH Merge or MP3 Extraction with Live SSE Progress
    eventSourceRef.current?.close();
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
        // Ignore malformed heartbeat chunks
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

    // Slight delay ensures SSE listener registers on backend before merge starts
    setTimeout(() => {
      triggerBrowserDownload(`${API_BASE_URL}/api/media/download?${params.toString()}`);
    }, 150);
  };

  const platformMeta = PLATFORM_STYLES[detectedPlatform];
  const filteredFormats =
    media?.formats.filter((format) => format.type === activeTab) || [];

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      {/* URL Input Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${platformMeta.badge}`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            {platformMeta.name}
          </span>

          <button
            type="button"
            onClick={handleClipboardButton}
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            Paste Link
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchMediaInfo(url);
          }}
          className={`flex flex-col sm:flex-row gap-3 bg-slate-950 border border-slate-800 rounded-xl p-2 transition-colors ${platformMeta.ring}`}
        >
          <div className="relative flex-1 flex items-center">
            <input
              type="url"
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              onPaste={handlePaste}
              placeholder="Paste YouTube, Facebook, Instagram, or TikTok URL..."
              className="w-full bg-transparent px-3 py-2.5 text-sm sm:text-base text-slate-100 placeholder-slate-500 focus:outline-none pr-8"
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
                aria-label="Clear URL"
                className="absolute right-2 text-slate-500 hover:text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-medium text-sm px-6 py-3 rounded-lg transition-colors cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Get Media
              </>
            )}
          </button>
        </form>

        {error && (
          <div className="mt-4 flex items-start gap-2.5 bg-red-950/50 border border-red-500/30 text-red-300 text-sm rounded-xl p-3.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Skeleton Loader */}
      {loading && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 animate-pulse space-y-5">
          <div className="flex flex-col sm:flex-row gap-5">
            <div className="w-full sm:w-52 h-32 bg-slate-800 rounded-xl shrink-0" />
            <div className="flex-1 space-y-3 py-1">
              <div className="h-5 bg-slate-800 rounded w-3/4" />
              <div className="h-4 bg-slate-800 rounded w-1/3" />
              <div className="h-8 bg-slate-800 rounded w-44 mt-4" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div className="h-14 bg-slate-800 rounded-xl" />
            <div className="h-14 bg-slate-800 rounded-xl" />
          </div>
        </div>
      )}

      {/* Extracted Media Result & Format Picker */}
      {media && !loading && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
          {/* Preview Header */}
          <div className="p-5 sm:p-6 border-b border-slate-800 flex flex-col sm:flex-row gap-5">
            <div className="relative w-full sm:w-56 aspect-video bg-slate-950 rounded-xl overflow-hidden shrink-0 border border-slate-800">
              {media.thumbnail ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={media.thumbnail}
                  alt={media.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-600">
                  <Film className="w-8 h-8" />
                </div>
              )}
              {media.duration > 0 && (
                <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs font-mono px-2 py-0.5 rounded">
                  {formatDuration(media.duration)}
                </span>
              )}
            </div>

            <div className="flex-1 min-w-0 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                      PLATFORM_STYLES[media.platform].badge
                    }`}
                  >
                    {PLATFORM_STYLES[media.platform].name}
                  </span>
                  <span className="text-xs text-slate-400 truncate">
                    {media.uploader}
                  </span>
                </div>
                <h2 className="text-base sm:text-lg font-semibold text-slate-100 line-clamp-2">
                  {media.title}
                </h2>
              </div>

              {/* Video / Audio Mode Switcher */}
              <div className="inline-flex bg-slate-950 p-1 rounded-xl border border-slate-800 w-fit mt-4">
                <button
                  type="button"
                  onClick={() => setActiveTab('video')}
                  className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    activeTab === 'video'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Film className="w-3.5 h-3.5" />
                  Video (MP4)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('audio')}
                  className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    activeTab === 'audio'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Music className="w-3.5 h-3.5" />
                  Audio (MP3)
                </button>
              </div>
            </div>
          </div>

          {/* Live FFmpeg / MP3 Progress Bar */}
          {jobProgress && activeFormatId && (
            <div className="px-6 py-4 bg-slate-950/80 border-b border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium flex items-center gap-2">
                  {jobProgress.status === 'ready' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                  )}
                  {jobProgress.status === 'starting' && 'Preparing stream...'}
                  {jobProgress.status === 'downloading' && 'Fetching high-definition tracks...'}
                  {jobProgress.status === 'merging' && 'Merging video and audio with FFmpeg...'}
                  {jobProgress.status === 'ready' && 'Download started!'}
                </span>
                <span className="font-mono text-emerald-400">{jobProgress.percent}%</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${jobProgress.percent}%` }}
                />
              </div>
            </div>
          )}

          {/* Download Options Grid */}
          <div className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredFormats.map((format) => {
              const sizeText = formatBytes(format.filesizeApprox);
              const isProcessing = activeFormatId === format.formatId;

              return (
                <button
                  key={format.formatId}
                  type="button"
                  disabled={Boolean(activeFormatId)}
                  onClick={() => handleDownloadClick(format)}
                  className="group flex items-center justify-between p-4 rounded-xl bg-slate-950 hover:bg-slate-800/80 border border-slate-800 hover:border-emerald-500/50 disabled:opacity-60 transition-all text-left cursor-pointer"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-100">
                        {format.label}
                      </span>
                      {!format.needsMerge && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                          <Zap className="w-3 h-3" />
                          Instant
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">
                      {format.ext.toUpperCase()}
                      {sizeText ? ` • ~${sizeText}` : ''}
                      {format.needsMerge ? ' • Server HD Merge' : ' • Direct Stream'}
                    </p>
                  </div>

                  <div className="w-9 h-9 rounded-lg bg-slate-900 group-hover:bg-emerald-600 flex items-center justify-center text-slate-300 group-hover:text-white transition-colors shrink-0">
                    {isProcessing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
