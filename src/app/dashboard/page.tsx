// src/app/dashboard/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard");

  const { me, seller } = await ensureSeller();

  const listings = await prisma.listing.findMany({
    where: { sellerId: seller.id },
    include: { photos: { orderBy: { sortOrder: "asc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <main className="max-w-6xl mx-auto p-8">
      <header className="mb-10">
        <h1 className="text-4xl font-bold">Welcome, {me.name ?? me.email.split("@")[0]} 👋</h1>
        <p className="text-neutral-600 mt-2">Signed in as {me.email}</p>

        <div className="mt-6 flex gap-3">
          <Link
            href="/dashboard/listings/new"
            className="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-medium shadow-sm hover:bg-neutral-50"
          >
            + Create listing
          </Link>
          <Link
            href="/browse"
            className="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-medium hover:bg-neutral-50"
          >
            Browse
          </Link>
        </div>
      </header>

      <section>
        <h2 className="text-xl font-semibold mb-4">My Listings</h2>

        {listings.length === 0 ? (
          <div className="rounded-xl border p-8 text-neutral-600">
            You don’t have any listings yet. Click <b>Create listing</b> to get started.
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {listings.map((l) => {
              const thumb = l.photos[0]?.url;
              return (
                <li key={l.id} className="overflow-hidden rounded-xl border">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt={l.title} className="h-48 w-full object-cover" />
                  ) : (
                    <div className="h-48 w-full bg-neutral-100" />
                  )}
                  <div className="p-4 space-y-1">
                    <div className="flex items-baseline justify-between">
                      <h3 className="font-medium">{l.title}</h3>
                      <span className="text-sm text-neutral-500">
                        {(l.priceCents / 100).toLocaleString(undefined, {
                          style: "currency",
                          currency: l.currency,
                        })}
                      </span>
                    </div>
                    <div className="text-xs uppercase tracking-wide text-neutral-500">{l.status}</div>
                    <div className="pt-3">
                      <Link href={`/dashboard/listings/${l.id}/edit`} className="text-sm underline hover:no-underline">
                        Edit
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}











