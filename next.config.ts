import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

/** Common cache durations for runtime caching (seconds). */
const ONE_YEAR = 365 * 24 * 60 * 60;
const THIRTY_DAYS = 30 * 24 * 60 * 60;
const SEVEN_DAYS = 7 * 24 * 60 * 60;

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
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
          expiration: { maxEntries: 10, maxAgeSeconds: ONE_YEAR },
        },
      },
      {
        // Cache images (PNG, JPG, SVG, etc.)
        urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "images",
          expiration: { maxEntries: 100, maxAgeSeconds: THIRTY_DAYS },
        },
      },
      {
        // Cache JS/CSS bundles (Next.js _next/static)
        urlPattern: /\/_next\/static\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "static-assets",
          expiration: { maxEntries: 200, maxAgeSeconds: ONE_YEAR },
        },
      },
      {
        // Mapbox tiles — network first with offline fallback
        urlPattern: /^https:\/\/api\.mapbox\.com\/.*/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "mapbox-tiles",
          expiration: { maxEntries: 300, maxAgeSeconds: SEVEN_DAYS },
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
