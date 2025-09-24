// src/app/listing/[id]/page.tsx
import { prisma } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function ListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params; // ✅ await params

  const listing = await prisma.listing.findUnique({
    where: { id },
    include: {
      photos: { orderBy: { sortOrder: "asc" } },
      seller: { include: { user: true } },
    },
  });

  if (!listing) return notFound();

  const hero = listing.photos[0]?.url ?? "/favicon.ico";

  return (
    <main className="p-8 max-w-4xl mx-auto space-y-6">
      <Link href="/browse" className="text-sm underline">
        &larr; Back to Browse
      </Link>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="relative w-full aspect-square overflow-hidden rounded-xl border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={hero} alt={listing.title} className="w-full h-full object-cover" />
        </div>

        <div className="space-y-4">
          <h1 className="text-2xl font-semibold">{listing.title}</h1>
          <div className="text-lg">${(listing.priceCents / 100).toFixed(2)}</div>
          <p className="text-sm opacity-80">{listing.description}</p>

          <div className="text-sm">
            Seller:{" "}
            <Link
              href={`/seller/${listing.seller.id}`}
              className="font-medium underline hover:no-underline"
            >
              {listing.seller.displayName ?? listing.seller.user?.email}
            </Link>
          </div>
        </div>
      </div>

      {listing.photos.length > 1 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {listing.photos.slice(1).map((p) => (
            <div key={p.id} className="relative aspect-square overflow-hidden rounded-lg border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

