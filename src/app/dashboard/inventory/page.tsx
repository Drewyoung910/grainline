// src/app/dashboard/inventory/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import InventoryRow from "./InventoryRow";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function InventoryPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/inventory");

  const { seller } = await ensureSeller();

  const listings = await prisma.listing.findMany({
    where: { sellerId: seller.id, listingType: "IN_STOCK" },
    include: {
      photos: { orderBy: { sortOrder: "asc" }, take: 1 },
      _count: { select: { favorites: true, stockNotifications: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  const active = listings.filter((l) => l.status !== "SOLD_OUT" && l.status !== "SOLD");
  const outOfStock = listings.filter((l) => l.status === "SOLD_OUT");
  const pendingReviewCount = listings.filter((l) => l.status === "PENDING_REVIEW").length;

  return (
    <main className="mx-auto max-w-7xl p-8 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Manage stock quantities for your In Stock listings.
        </p>
      </header>

      {pendingReviewCount > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">
            {pendingReviewCount === 1 ? "1 listing is under review." : `${pendingReviewCount} listings are under review.`}
          </span>{" "}
          Most reviews finish within 1-2 business days. Your saved stock changes are kept, and we&apos;ll notify you when a listing goes live or needs edits.
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-neutral-800">
          Active ({active.length})
        </h2>
        {active.length === 0 ? (
          <div className="card-section px-4 py-6 text-sm text-neutral-500">
            No active in-stock listings.
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100 card-section">
            {active.map((l) => (
              <InventoryRow key={l.id} listing={l} />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-neutral-800">
          Out of Stock ({outOfStock.length})
        </h2>
        {outOfStock.length === 0 ? (
          <div className="card-section px-4 py-6 text-sm text-neutral-500">
            No out-of-stock listings.
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100 card-section">
            {outOfStock.map((l) => (
              <InventoryRow key={l.id} listing={l} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
