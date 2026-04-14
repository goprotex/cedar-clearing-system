import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/ui/sonner";
import AuthProvider from "@/components/AuthProvider";
import AuthRequiredGate from "@/components/AuthRequiredGate";
import PwaManager from "@/components/PwaManager";
import "./globals.css";

// Self-hosted Space Grotesk variable font — avoids build-time Google Fonts
// fetch (which can 403 from CI egress IPs).
const spaceGrotesk = localFont({
  src: "../../public/fonts/SpaceGrotesk.ttf",
  variable: "--font-space-grotesk",
  weight: "300 700",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cedar Hack",
  description: "AI-Powered Clearing Company Operating System",
  applicationName: "Cedar Hack",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Cedar Hack",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/icon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#131313",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} dark h-full antialiased scroll-smooth overflow-x-hidden`}
    >
      <body className="min-h-full flex flex-col font-[family-name:var(--font-space-grotesk)] bg-[#131313] text-[#e5e2e1] overflow-x-hidden">
        <AuthProvider>
          <AuthRequiredGate>{children}</AuthRequiredGate>
        </AuthProvider>
        <Toaster position="bottom-right" richColors />
        <PwaManager />
      </body>
    </html>
  );
}
