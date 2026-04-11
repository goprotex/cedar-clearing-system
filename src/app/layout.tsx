import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import AuthProvider from "@/components/AuthProvider";
import AuthRequiredGate from "@/components/AuthRequiredGate";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const viewport: Viewport = {
  themeColor: "#131313",
  colorScheme: "dark",
};

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
  icons: {
    icon: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/icon-192x192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
      </body>
    </html>
  );
}
