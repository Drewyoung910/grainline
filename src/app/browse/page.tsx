// src/app/browse/page.tsx
import { prisma } from "@/lib/db";
import Link from "next/link";

const PAGE_SIZE = 24;

export default async function BrowsePage() {
  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      include: {
        photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
        seller: { include: { user: true } }, // 👈 pull seller + user for the chip
      },
    }),
    prisma.listing.count(),
  ]);

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-end justify-between">
        <h1 className="text-2xl font-semibold">Browse</h1>
        <div className="text-sm text-neutral-500">{total} item{total === 1 ? "" : "s"}</div>
      </header>

      <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {listings.map((l) => {
          const img = l.photos[0]?.url ?? "/favicon.ico";
          const sellerName = l.seller.displayName ?? l.seller.user?.email ?? "Seller";
          const sellerHref = `/seller/${l.sellerId}`; // Listing.sellerId references SellerProfile.id

          return (
            <li key={l.id} className="border rounded-xl overflow-hidden">
              <Link href={`/listing/${l.id}`} className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt={l.title} src={img} className="w-full h-48 object-cover" />
                <div className="p-4 space-y-2">
                  <div className="flex items-baseline justify-between">
                    <div className="font-medium">{l.title}</div>
                    <div className="opacity-70">
                      ${(l.priceCents / 100).toFixed(2)}
                    </div>
                  </div>
                </div>
              </Link>

              {/* Seller chip (separate link so you can click straight to the profile) */}
              <div className="px-4 pb-4">
                <Link
                  href={sellerHref}
                  className="inline-flex items-center text-xs rounded-full border px-3 py-1 hover:bg-neutral-50"
                >
                  {sellerName}
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

