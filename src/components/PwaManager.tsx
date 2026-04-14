'use client';

import { useEffect, useState, useCallback } from 'react';

/**
 * Handles PWA lifecycle: service-worker update prompts and iOS "Add to Home Screen" banner.
 *
 * Renders nothing most of the time — only shows a toast-style banner when:
 *  1. A new service worker is waiting (update available).
 *  2. The user is on iOS Safari and hasn't installed yet (install hint).
 */
export default function PwaManager() {
  const [updateReady, setUpdateReady] = useState(false);
  const [showInstall, setShowInstall] = useState(false);

  /* ---------- Service-worker update detection ---------- */
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- used for cleanup ref
    let reg: ServiceWorkerRegistration | null = null;

    navigator.serviceWorker.getRegistration().then((r) => {
      if (!r) return;
      reg = r;

      const onStateChange = () => {
        if (r.waiting) setUpdateReady(true);
      };

      if (r.waiting) {
        setUpdateReady(true);
      }

      r.addEventListener('updatefound', () => {
        const sw = r.installing;
        sw?.addEventListener('statechange', onStateChange);
      });
    });

    return () => { reg = null; };
  }, []);

  const applyUpdate = useCallback(() => {
    navigator.serviceWorker.getRegistration().then((r) => {
      r?.waiting?.postMessage({ type: 'SKIP_WAITING' });
    });
    setUpdateReady(false);
    // Reload after a brief delay so the new SW activates
    setTimeout(() => window.location.reload(), 400);
  }, []);

  /* ---------- iOS install banner ---------- */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Already running as standalone PWA
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true);
    if (isStandalone) return;

    // iOS Safari only
    const ua = navigator.userAgent;
    const isIos = /iP(hone|ad|od)/.test(ua);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua);
    if (!isIos || !isSafari) return;

    // Only show once per session
    const dismissed = sessionStorage.getItem('ccc_pwa_install_dismissed');
    if (dismissed) return;

    // Delay prompt so it doesn't flash immediately on first visit
    const timer = setTimeout(() => setShowInstall(true), 6000);
    return () => clearTimeout(timer);
  }, []);

  const dismissInstall = useCallback(() => {
    setShowInstall(false);
    try { sessionStorage.setItem('ccc_pwa_install_dismissed', '1'); } catch { /* ignore */ }
  }, []);

  if (!updateReady && !showInstall) return null;

  return (
    <>
      {/* SW update banner */}
      {updateReady && (
        <div className="fixed bottom-4 left-4 right-4 z-[9999] md:left-auto md:right-6 md:max-w-sm bg-[#1c1b1b] border border-[#FF6B00] p-4 shadow-[0_0_20px_rgba(255,107,0,0.2)]" role="alert">
          <p className="text-xs font-bold text-[#ffb693] mb-2 uppercase tracking-wider">
            Update Available
          </p>
          <p className="text-[11px] text-[#e5e2e1] mb-3">
            A new version of Cedar Hack is ready. Reload to get the latest features.
          </p>
          <div className="flex gap-2">
            <button
              onClick={applyUpdate}
              className="flex-1 bg-[#FF6B00] text-black text-xs font-black uppercase tracking-wider py-2 px-3 hover:bg-white transition-colors"
            >
              Reload Now
            </button>
            <button
              onClick={() => setUpdateReady(false)}
              className="border border-[#353534] text-[#a98a7d] text-xs font-bold uppercase px-3 py-2 hover:bg-[#353534] transition-colors"
            >
              Later
            </button>
          </div>
        </div>
      )}

      {/* iOS install hint */}
      {showInstall && !updateReady && (
        <div className="fixed bottom-4 left-4 right-4 z-[9999] md:left-auto md:right-6 md:max-w-sm bg-[#1c1b1b] border border-[#13ff43] p-4 shadow-[0_0_20px_rgba(19,255,67,0.15)]" role="alert">
          <button
            onClick={dismissInstall}
            className="absolute top-2 right-3 text-[#a98a7d] hover:text-white text-sm"
            aria-label="Dismiss"
          >
            ✕
          </button>
          <p className="text-xs font-bold text-[#13ff43] mb-2 uppercase tracking-wider">
            Install Cedar Hack
          </p>
          <p className="text-[11px] text-[#e5e2e1] mb-1">
            Tap <span className="inline-block align-text-bottom">
              {/* iOS share icon */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline text-[#13ff43]">
                <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
            </span> then <strong>&quot;Add to Home Screen&quot;</strong> for the best experience — works offline, full-screen, and faster.
          </p>
          <button
            onClick={dismissInstall}
            className="mt-2 text-[10px] text-[#a98a7d] hover:text-white underline"
          >
            Got it
          </button>
        </div>
      )}
    </>
  );
}
