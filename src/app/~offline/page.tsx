import Link from "next/link";

/** Offline fallback for the PWA service worker (referenced in next.config). */
export default function OfflinePage() {
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#131313] text-[#e5e2e1] px-6">
      <div className="text-center space-y-4 max-w-md">
        <div className="text-[#FF6B00] text-2xl font-black uppercase tracking-widest">OFFLINE</div>
        <p className="text-sm text-[#a98a7d]">
          No network connection. Cached pages may still open; reconnect to sync data with the server.
        </p>
        <Link
          href="/"
          className="inline-block mt-4 bg-[#13ff43] text-black px-6 py-3 font-bold uppercase tracking-widest text-sm hover:bg-white transition-colors"
        >
          Home
        </Link>
      </div>
    </div>
  );
}
