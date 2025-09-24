// src/app/browse/page.tsx
import { prisma } from "@/lib/db";
import Link from "next/link";
import { ListingStatus } from "@prisma/client";

const PAGE_SIZE = 24;

export default async function BrowsePage() {
  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where: { status: ListingStatus.ACTIVE }, // 👈 only active
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      include: {
        photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
        seller: { include: { user: true } },
      },
    }),
    prisma.listing.count({ where: { status: ListingStatus.ACTIVE } }),
  ]);

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-end justify-between">
        <h1 className="text-2xl font-semibold">Browse</h1>
        <div className="text-sm text-neutral-500">
          {total} item{total === 1 ? "" : "s"}
        </div>
      </header>

      <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {listings.map((l) => {
          const img = l.photos[0]?.url ?? "/favicon.ico";
          const sellerName = l.seller.displayName ?? l.seller.user?.email ?? "Seller";
          const sellerHref = `/seller/${l.sellerId}`;
          const sellerAvatar = l.seller.user?.imageUrl ?? null;

          const initials =
            (sellerName || "S")
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase() ?? "")
              .join("") || "S";

          return (
            <li key={l.id} className="border rounded-xl overflow-hidden">
              <Link href={`/listing/${l.id}`} className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt={l.title} src={img} className="w-full h-48 object-cover" />
                <div className="p-4 space-y-2">
                  <div className="flex items-baseline justify-between">
                    <div className="font-medium">{l.title}</div>
                    <div className="opacity-70">${(l.priceCents / 100).toFixed(2)}</div>
                  </div>
                </div>
              </Link>

              <div className="px-4 pb-4">
                <Link
                  href={sellerHref}
                  className="inline-flex items-center gap-2 text-xs rounded-full border px-3 py-1 hover:bg-neutral-50"
                >
                  {sellerAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={sellerAvatar} alt={sellerName} className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <div className="h-5 w-5 rounded-full bg-neutral-200 flex items-center justify-center">
                      <span className="text-[10px] font-medium text-neutral-700">{initials}</span>
                    </div>
                  )}
                  <span>{sellerName}</span>
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}



