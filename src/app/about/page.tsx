import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { publicListingWhere } from "@/lib/listingVisibility";
import { sellerPublicMarketplaceCounts } from "@/lib/sellerProfilePublicAccess";
import { getPublicActiveMemberCount } from "@/lib/userPublicIdentityAccess";

export const metadata: Metadata = {
  title: { absolute: "About Grainline" },
  description: "Grainline is a marketplace connecting buyers with independent woodworking makers across the country.",
  alternates: { canonical: "https://thegrainline.com/about" },
};

export default async function AboutPage() {
  const { userId } = await auth();
  const makerLink = userId ? "/dashboard" : "/sign-up";

  const [listingCount, marketplaceCounts, memberCount] = await Promise.all([
    prisma.listing.count({ where: publicListingWhere() }),
    sellerPublicMarketplaceCounts(),
    getPublicActiveMemberCount(),
  ]);
  const sellerCount = marketplaceCounts.activeSellerCount;
  // Same rule as the homepage: tiny pre-launch totals read as an empty shop.
  const showStats = sellerCount >= 25 && listingCount >= 100;

  return (
    <div className="min-h-[100svh]">
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-16">

        <div className="mb-12">
          <h1 className="text-4xl sm:text-5xl font-display font-bold text-neutral-900 mb-4 leading-tight">
            Built for people who make things with their hands.
          </h1>
          <p className="text-lg text-stone-500 leading-relaxed">
            Grainline is a marketplace for handmade woodworking: furniture, kitchen pieces, decor, toys, and more, made by independent craftspeople across the country.
          </p>
        </div>

        {showStats && (
          <div className="grid grid-cols-3 gap-4 mb-12">
            <div>
              <div className="text-3xl font-bold text-neutral-900">{listingCount.toLocaleString("en-US")}</div>
              <div className="text-sm text-stone-500 mt-1">handmade pieces listed</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-neutral-900">{sellerCount.toLocaleString("en-US")}</div>
              <div className="text-sm text-stone-500 mt-1">active makers</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-neutral-900">{memberCount.toLocaleString("en-US")}</div>
              <div className="text-sm text-stone-500 mt-1">members</div>
            </div>
          </div>
        )}

        <div className="space-y-6 mb-12">
          <div>
            <h2 className="text-2xl font-display font-semibold text-neutral-900 mb-2">Why Grainline exists</h2>
            <p className="text-neutral-600 leading-relaxed">
              Most online marketplaces treat woodworking like any other product category, lost between mass-produced furniture and factory goods. We built Grainline specifically for the woodworking community, with features that matter: local maker maps, made-to-order workflows, and Guild badges that confirm a maker&apos;s complete profile and good standing on Grainline.
            </p>
          </div>
          <div>
            <h2 className="text-2xl font-display font-semibold text-neutral-900 mb-2">For makers</h2>
            <p className="text-neutral-600 leading-relaxed">
              We charge a simple 5% fee on sales, with no listing fees and no subscription. You set your own policies, prices, and shipping. Guild badges show buyers which shops have a complete profile and good standing here.
            </p>
          </div>
          <div>
            <h2 className="text-2xl font-display font-semibold text-neutral-900 mb-2">For buyers</h2>
            <p className="text-neutral-600 leading-relaxed">
              Browse by category, filter by location, or search for a specific piece. Contact a maker directly about custom work. If something goes wrong with an eligible order, our case system connects you with the maker and our team.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/browse"
            className="inline-flex items-center rounded-full bg-[#2C1F1A] px-6 py-3 text-sm font-medium text-white hover:bg-[#3A2A24]"
          >
            Browse the Workshop
          </Link>
          <Link
            href={makerLink}
            className="inline-flex items-center rounded-full border-2 border-[#2C1F1A] px-6 py-3 text-sm font-medium text-[#2C1F1A] hover:bg-[#2C1F1A] hover:text-white"
          >
            Become a Maker
          </Link>
        </div>
      </main>
    </div>
  );
}
