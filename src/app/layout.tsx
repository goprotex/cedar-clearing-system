import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Cedar Hack",
  description: "AI-Powered Clearing Company Operating System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-[family-name:var(--font-space-grotesk)] bg-[#131313] text-[#e5e2e1]">
        <AuthProvider>
          <AuthRequiredGate>{children}</AuthRequiredGate>
        </AuthProvider>
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
