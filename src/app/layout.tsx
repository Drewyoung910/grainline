// src/app/layout.tsx
import "./globals.css";
import Header from "@/components/Header";
import { Providers } from "@/components/Providers";
import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import Link from "next/link";

export const viewport: Viewport = {
  themeColor: "#1C1917",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://grainline.co"),
  title: {
    default: "Grainline — Handmade Woodworking Marketplace",
    template: "%s | Grainline",
  },
  description:
    "Discover unique handmade woodworking pieces from local artisans. Shop furniture, kitchen items, decor and more from makers near you.",
  keywords: [
    "woodworking",
    "handmade",
    "marketplace",
    "local artisans",
    "wood furniture",
    "custom woodworking",
  ],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Grainline",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    siteName: "Grainline",
    title: "Grainline — Handmade Woodworking Marketplace",
    description: "Discover unique handmade woodworking pieces from local artisans.",
    images: [{ url: "/og-image.jpg", width: 1200, height: 630, alt: "Grainline Marketplace" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Grainline",
    description: "Handmade woodworking marketplace",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900">
        <Providers>
          <Suspense fallback={null}>
            <Header />
          </Suspense>
          {children}
          <footer className="border-t border-neutral-200 mt-16 py-6 px-6 text-center text-xs text-neutral-400">
            <div className="flex justify-center mb-3">
              <img src="/logo.svg" alt="Grainline" className="h-5 w-auto" style={{ filter: "brightness(0)", opacity: 0.4 }} />
            </div>
            <div className="flex flex-wrap justify-center gap-4">
              <Link href="/terms" className="hover:text-neutral-600 hover:underline">Terms of Service</Link>
              <Link href="/privacy" className="hover:text-neutral-600 hover:underline">Privacy Policy</Link>
            </div>
            <p className="mt-2">&copy; {new Date().getFullYear()} Grainline. All rights reserved.</p>
          </footer>
        </Providers>
      </body>
    </html>
  );
}






