// src/app/dashboard/inventory/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import InventoryRow from "./InventoryRow";

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

  return (
    <main className="mx-auto max-w-4xl p-8 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Manage stock quantities for your In Stock listings.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-neutral-800">
          Active ({active.length})
        </h2>
        {active.length === 0 ? (
          <div className="rounded-lg border px-4 py-6 text-sm text-neutral-500">
            No active in-stock listings.
          </div>
        ) : (
          <ul className="divide-y rounded-xl border bg-white">
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
          <div className="rounded-lg border px-4 py-6 text-sm text-neutral-500">
            No out-of-stock listings.
          </div>
        ) : (
          <ul className="divide-y rounded-xl border bg-white">
            {outOfStock.map((l) => (
              <InventoryRow key={l.id} listing={l} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
