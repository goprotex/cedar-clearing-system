import type { MetadataRoute } from "next";

/** PWA manifest for field operators (Add to Home Screen, standalone display). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Cedar Hack — Field Ops",
    short_name: "Cedar Hack",
    description:
      "AI-powered clearing company OS: bids, GPS operate mode, scout monitor, and job execution for crews in the field.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "browser"],
    background_color: "#131313",
    theme_color: "#131313",
    orientation: "any",
    categories: ["business", "productivity", "utilities"],
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
