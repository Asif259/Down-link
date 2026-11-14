import MediaDownloader from '../components/MediaDownloader';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center px-4 py-14">
      <div className="text-center max-w-xl mx-auto mb-10 space-y-3">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
          All-in-One Media Downloader
        </h1>
        <p className="text-sm sm:text-base text-slate-400">
          Paste any link from YouTube, Facebook, Instagram, or TikTok to download HD video or MP3 audio.
        </p>
      </div>

      <MediaDownloader />
    </main>
  );
}
