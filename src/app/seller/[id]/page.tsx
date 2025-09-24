// src/app/seller/[id]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";

export default async function SellerPublicPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params; // ✅ await params

  const seller = await prisma.sellerProfile.findUnique({
    where: { id },
    include: { user: true },
  });

  if (!seller) return notFound();

  const listings = await prisma.listing.findMany({
    where: { sellerId: seller.id },
    include: { photos: { orderBy: { sortOrder: "asc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <main className="max-w-6xl mx-auto p-8 space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold">{seller.displayName}</h1>
          <p className="text-sm text-neutral-600">
            {seller.city && seller.state
              ? `${seller.city}, ${seller.state}`
              : seller.city || seller.state || "—"}
          </p>
          {seller.user?.email && (
            <p className="text-sm text-neutral-500 mt-1">
              Contact: <span className="font-mono">{seller.user.email}</span>
            </p>
          )}
        </div>
        <Link href="/browse" className="text-sm underline">
          &larr; Back to Browse
        </Link>
      </div>

      {seller.bio && (
        <section className="rounded-xl border p-4">
          <h2 className="text-lg font-medium mb-2">About</h2>
          <p className="text-neutral-700 whitespace-pre-line">{seller.bio}</p>
        </section>
      )}

      <section>
        <h2 className="text-lg font-medium mb-3">Listings</h2>
        {listings.length === 0 ? (
          <div className="rounded-xl border p-6 text-neutral-600">No listings yet.</div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            {listings.map((l) => {
              const thumb = l.photos[0]?.url ?? "/favicon.ico";
              return (
                <li key={l.id} className="overflow-hidden rounded-xl border">
                  <Link href={`/listing/${l.id}`} className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumb} alt={l.title} className="h-48 w-full object-cover" />
                    <div className="p-4">
                      <div className="font-medium">{l.title}</div>
                      <div className="text-sm text-neutral-500">
                        {(l.priceCents / 100).toLocaleString(undefined, {
                          style: "currency",
                          currency: l.currency,
                        })}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

