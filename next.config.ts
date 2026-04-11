import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

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
});

const nextConfig: NextConfig = {
  /* config options here */
};

export default withPWA(nextConfig);
