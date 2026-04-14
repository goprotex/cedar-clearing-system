'use client';

import Link from "next/link";

/** Offline fallback for the PWA service worker (referenced in next.config). */
export default function OfflinePage() {
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#131313] text-[#e5e2e1] px-6 safe-bottom safe-top">
      <div className="text-center space-y-6 max-w-md">
        {/* Animated offline icon */}
        <div className="relative mx-auto w-20 h-20 flex items-center justify-center">
          <div className="absolute inset-0 border-2 border-[#FF6B00] opacity-30 animate-ping" />
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#FF6B00"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
        </div>

        <div className="text-[#FF6B00] text-2xl font-black uppercase tracking-widest">
          OFFLINE
        </div>

        <p className="text-sm text-[#a98a7d] leading-relaxed">
          No network connection detected. Cached pages may still be available.
          Reconnect to sync data with the server.
        </p>

        <div className="space-y-3 pt-2">
          <Link
            href="/"
            className="inline-block w-full bg-[#13ff43] text-black px-6 py-3 font-bold uppercase tracking-widest text-sm hover:bg-white transition-colors text-center"
          >
            Try Home
          </Link>
          <button
            onClick={() => typeof window !== 'undefined' && window.location.reload()}
            className="inline-block w-full border-2 border-[#353534] text-[#e5e2e1] px-6 py-3 font-bold uppercase tracking-widest text-sm hover:bg-[#353534] transition-colors text-center"
          >
            Retry Connection
          </button>
        </div>

        <p className="text-[10px] text-[#5a4136] mt-4">
          CEDAR HACK • PWA STANDALONE MODE
        </p>
      </div>
    </div>
  );
}
