// src/app/layout.tsx
import "./globals.css";
import Header from "@/components/Header";
import { Providers } from "@/components/Providers";
import type { Metadata } from "next";
import { Suspense } from "react";

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
        </Providers>
      </body>
    </html>
  );
}






