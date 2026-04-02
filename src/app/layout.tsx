// src/app/layout.tsx
import "./globals.css";
import Header from "@/components/Header";
import { Providers } from "@/components/Providers";
import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { prisma } from "@/lib/db";

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
  icons: {
    icon: "/favicon.png",
    apple: "/icon-192.png",
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

// TODO: Add Google Search Console verification meta tag — Drew will add this manually from search.google.com/search-console
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const footerMetros = await prisma.metro.findMany({
    where: {
      isActive: true,
      OR: [
        { listings: { some: { status: "ACTIVE", isPrivate: false, seller: { chargesEnabled: true } } } },
        { sellerProfiles: { some: { chargesEnabled: true } } },
      ],
    },
    select: { slug: true, name: true, state: true, _count: { select: { listings: true } } },
    orderBy: { listings: { _count: "desc" } },
    take: 10,
  }).catch(() => [] as { slug: string; name: string; state: string; _count: { listings: number } }[]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-[#F7F5F0] text-neutral-900">
        <Providers>
          <Suspense fallback={null}>
            <Header />
          </Suspense>
          {children}
          <footer className="border-t border-stone-200 mt-16 py-10 px-6 text-center text-xs text-stone-400">
            <div className="flex justify-center mb-4">
              <img src="/logo.svg" alt="Grainline" className="h-5 w-auto" style={{ filter: "brightness(0) sepia(1) saturate(3) hue-rotate(-10deg) brightness(0.2)", opacity: 0.4 }} />
            </div>
            {/* Browse by City — dynamic, only shown when metros have content */}
            {footerMetros.length > 0 && (
              <div className="mb-4">
                <p className="text-[11px] text-stone-400 uppercase tracking-wide mb-2">Browse by city</p>
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
                  {footerMetros.map((m) => (
                    <Link key={m.slug} href={`/browse/${m.slug}`} className="hover:text-stone-600 hover:underline">
                      {m.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-4 mb-2">
              <Link href="/terms" className="hover:text-stone-600 hover:underline">Terms of Service</Link>
              <Link href="/privacy" className="hover:text-stone-600 hover:underline">Privacy Policy</Link>
              <Link href="/blog" className="hover:text-stone-600 hover:underline">Blog</Link>
              <Link href="/commission" className="hover:text-stone-600 hover:underline">Commission Room</Link>
            </div>
            <p className="mt-2">&copy; {new Date().getFullYear()} Grainline. All rights reserved.</p>
          </footer>
        </Providers>
      </body>
    </html>
  );
}






