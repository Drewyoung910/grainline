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
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://thegrainline.com"),
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
    images: [{ url: "/og-image.jpg", width: 1200, height: 630, alt: "Grainline" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Grainline",
    description: "Handmade woodworking marketplace",
    images: ["/og-image.jpg"],
  },
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
  },
  robots: { index: true, follow: true },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const footerMetros = await prisma.metro.findMany({
    where: {
      isActive: true,
      OR: [
        {
          listings: {
            some: {
              status: "ACTIVE",
              isPrivate: false,
              seller: {
                chargesEnabled: true,
                vacationMode: false,
                user: { banned: false, deletedAt: null },
              },
            },
          },
        },
        {
          sellerProfiles: {
            some: {
              chargesEnabled: true,
              vacationMode: false,
              user: { banned: false, deletedAt: null },
            },
          },
        },
      ],
    },
    select: { slug: true, name: true, state: true, _count: { select: { listings: true } } },
    orderBy: { listings: { _count: "desc" } },
    take: 10,
  }).catch(() => [] as { slug: string; name: string; state: string; _count: { listings: number } }[]);

  return (
    <html lang="en">
      <body className="min-h-[100svh] flex flex-col bg-[#F7F5F0] text-neutral-900">
        <a href="#main-content" className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:z-[9999] focus-visible:bg-neutral-900 focus-visible:text-white focus-visible:px-4 focus-visible:py-2 focus-visible:rounded-md focus-visible:text-sm">
          Skip to content
        </a>
        <Providers>
          <Suspense fallback={null}>
            <Header />
          </Suspense>
          <div id="main-content" className="flex-1">
          {children}
          </div>
          <footer className="bg-[#3F5D3A] text-stone-200 py-12 px-6 text-center text-xs">
            <div className="flex justify-center mb-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-espresso.svg" alt="Grainline" className="h-5 w-auto invert opacity-80" />
            </div>
            {/* Browse by City — dynamic, only shown when metros have content */}
            {footerMetros.length > 0 && (
              <div className="mb-5">
                <p className="text-[11px] text-stone-300/80 uppercase tracking-wide mb-2">Browse by city</p>
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
                  {footerMetros.map((m) => (
                    <Link key={m.slug} href={`/browse/${m.slug}`} className="text-stone-200 hover:text-white hover:underline">
                      {m.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-4 mb-3">
              <Link href="/about" className="text-stone-200 hover:text-white hover:underline">About</Link>
              <Link href="/terms" className="text-stone-200 hover:text-white hover:underline">Terms of Service</Link>
              <Link href="/privacy" className="text-stone-200 hover:text-white hover:underline">Privacy Policy</Link>
              <Link href="/blog" className="text-stone-200 hover:text-white hover:underline">Blog</Link>
              <Link href="/commission" className="text-stone-200 hover:text-white hover:underline">Commission Room</Link>
              <Link href="/become-a-maker" className="text-stone-200 hover:text-white hover:underline">Become a Maker</Link>
              <Link href="/accessibility" className="text-stone-200 hover:text-white hover:underline">Accessibility</Link>
            </div>
            <p className="mt-2 text-stone-300/80">&copy; {new Date().getFullYear()} Grainline. All rights reserved.</p>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
