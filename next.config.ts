import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  cacheOnFrontEndNav: true,
  /** Precache shell + faster repeat visits; operate route benefits from cached JS/CSS. */
  aggressiveFrontEndNavCaching: true,
  /** App Router offline document (see src/app/~offline/page.tsx). */
  fallbacks: {
    document: "/~offline",
  },
  workboxOptions: {
    runtimeCaching: [
      {
        // Cache Google Fonts (if ever added)
        urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "google-fonts",
          expiration: { maxEntries: 10, maxAgeSeconds: 365 * 24 * 60 * 60 },
        },
      },
      {
        // Cache images (PNG, JPG, SVG, etc.)
        urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "images",
          expiration: { maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 },
        },
      },
      {
        // Cache JS/CSS bundles (Next.js _next/static)
        urlPattern: /\/_next\/static\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "static-assets",
          expiration: { maxEntries: 200, maxAgeSeconds: 365 * 24 * 60 * 60 },
        },
      },
      {
        // Mapbox tiles — network first with offline fallback
        urlPattern: /^https:\/\/api\.mapbox\.com\/.*/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "mapbox-tiles",
          expiration: { maxEntries: 300, maxAgeSeconds: 7 * 24 * 60 * 60 },
          networkTimeoutSeconds: 10,
        },
      },
      {
        // API routes — network only (no stale data)
        urlPattern: /\/api\/.*/i,
        handler: "NetworkOnly",
      },
    ],
  },
});

const nextConfig: NextConfig = {
  /* config options here */
};

export default withPWA(nextConfig);
