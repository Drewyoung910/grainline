// src/app/layout.tsx
import "./globals.css";
import Header from "@/components/Header";
import { Providers } from "@/components/Providers";
import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { publicListingWhere } from "@/lib/listingVisibility";
import { activeSellerProfileWhere } from "@/lib/sellerVisibility";

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
            some: publicListingWhere(),
          },
        },
        {
          sellerProfiles: {
            some: activeSellerProfileWhere(),
          },
        },
      ],
    },
    select: { slug: true, name: true, state: true, _count: { select: { listings: true } } },
    orderBy: { listings: { _count: "desc" } },
    take: 10,
  }).catch(() => [] as { slug: string; name: string; state: string; _count: { listings: number } }[]);

  return (
    <html lang="en" className="bg-[#F7F5F0]">
      <body className="min-h-[100dvh] flex flex-col bg-[#F7F5F0] text-neutral-900">
        <a href="#main-content" className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:z-[9999] focus-visible:bg-neutral-900 focus-visible:text-white focus-visible:px-4 focus-visible:py-2 focus-visible:rounded-md focus-visible:text-sm">
          Skip to content
        </a>
        <Providers>
          <Suspense fallback={null}>
            <Header />
          </Suspense>
          <div id="main-content" className="flex-1 bg-[#F7F5F0]">
          {children}
          </div>
          <footer className="bg-[#3F5D3A] text-stone-200 pt-14 pb-8 px-6 text-sm">
            <div className="max-w-[1600px] mx-auto">
              {/* Top row: logo + 4-column nav. Stacks on mobile, grid on md+. */}
              <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-5 gap-8 mb-10">
                {/* Logo + tagline column (full width on mobile, single col md+) */}
                <div className="col-span-2 sm:col-span-2 md:col-span-1 space-y-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo-espresso.svg" alt="Grainline" className="h-6 w-auto invert opacity-90" />
                  <p className="text-xs text-stone-300/80 leading-relaxed max-w-[200px]">
                    Handmade woodworking from makers in your area.
                  </p>
                </div>

                {/* Shop */}
                <nav aria-label="Shop">
                  <h3 className="font-semibold text-white text-sm mb-3">Shop</h3>
                  <ul className="space-y-2 text-xs">
                    <li><Link href="/browse" className="text-stone-300 hover:text-white hover:underline">Browse all</Link></li>
                    <li><Link href="/why-grainline" className="text-stone-300 hover:text-white hover:underline">Why Grainline</Link></li>
                    <li><Link href="/commission" className="text-stone-300 hover:text-white hover:underline">Commission a piece</Link></li>
                    <li><Link href="/map" className="text-stone-300 hover:text-white hover:underline">Find makers near you</Link></li>
                    <li><Link href="/blog" className="text-stone-300 hover:text-white hover:underline">Stories from the workshop</Link></li>
                  </ul>
                </nav>

                {/* Sell */}
                <nav aria-label="Sell">
                  <h3 className="font-semibold text-white text-sm mb-3">Sell</h3>
                  <ul className="space-y-2 text-xs">
                    <li><Link href="/why-sell-on-grainline" className="text-stone-300 hover:text-white hover:underline">Why sell on Grainline</Link></li>
                    <li><Link href="/become-a-maker" className="text-stone-300 hover:text-white hover:underline">Become a maker</Link></li>
                    <li><Link href="/seller-handbook" className="text-stone-300 hover:text-white hover:underline">Seller handbook</Link></li>
                    <li><Link href="/seller-handbook#fees" className="text-stone-300 hover:text-white hover:underline">Fees &amp; payouts</Link></li>
                    <li><Link href="/seller-handbook#guild" className="text-stone-300 hover:text-white hover:underline">Guild verification</Link></li>
                  </ul>
                </nav>

                {/* Help */}
                <nav aria-label="Help">
                  <h3 className="font-semibold text-white text-sm mb-3">Help</h3>
                  <ul className="space-y-2 text-xs">
                    <li><Link href="/support" className="text-stone-300 hover:text-white hover:underline">Contact support</Link></li>
                    <li><Link href="/help/shipping-and-returns" className="text-stone-300 hover:text-white hover:underline">Shipping &amp; returns</Link></li>
                    <li><Link href="/help/trust-and-safety" className="text-stone-300 hover:text-white hover:underline">Trust &amp; safety</Link></li>
                    <li><Link href="/accessibility" className="text-stone-300 hover:text-white hover:underline">Accessibility</Link></li>
                  </ul>
                </nav>

                {/* About / Legal */}
                <nav aria-label="Grainline">
                  <h3 className="font-semibold text-white text-sm mb-3">Grainline</h3>
                  <ul className="space-y-2 text-xs">
                    <li><Link href="/about" className="text-stone-300 hover:text-white hover:underline">About</Link></li>
                    <li><Link href="/terms" className="text-stone-300 hover:text-white hover:underline">Terms of Service</Link></li>
                    <li><Link href="/privacy" className="text-stone-300 hover:text-white hover:underline">Privacy Policy</Link></li>
                    <li><Link href="/legal/data-request" className="text-stone-300 hover:text-white hover:underline">Data request</Link></li>
                  </ul>
                </nav>
              </div>

              {/* Browse by City — only when metros have content */}
              {footerMetros.length > 0 && (
                <div className="border-t border-stone-200/15 pt-6 pb-6 mb-6">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-300/80 mb-3">Browse by city</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {footerMetros.map((m) => (
                      <Link key={m.slug} href={`/browse/${m.slug}`} className="text-stone-300 hover:text-white hover:underline">
                        {m.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Bottom bar — copyright + trust note */}
              <div className="border-t border-stone-200/15 pt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-stone-300/80">
                <p>&copy; {new Date().getFullYear()} Grainline LLC. All rights reserved.</p>
                <p className="text-stone-300/60">Built in Texas. Handmade pieces, real makers, fair fees.</p>
              </div>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
