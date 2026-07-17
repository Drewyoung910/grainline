import Link from "next/link";
import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { ensureUserForPage } from "@/lib/pageAuth";
import { deleteOwnerSavedSearch, listOwnerSavedSearches } from "@/lib/savedSearchOwnerAccess";
import { withDbUserContext } from "@/lib/dbUserContext";
import { formatCurrencyCents, formatCurrencyMinorUnitAmount } from "@/lib/money";
import { safeRateLimit, savedSearchRatelimit } from "@/lib/ratelimit";

export const metadata: Metadata = {
  title: "Saved Searches",
  robots: { index: false, follow: false },
};

async function deleteSavedSearch(searchId: string) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;
  const { success } = await safeRateLimit(savedSearchRatelimit, `account-delete:${userId}`);
  if (!success) return;
  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, banned: true, deletedAt: true },
  });
  if (!me || me.banned || me.deletedAt) return;
  await withDbUserContext(me.id, (tx) => deleteOwnerSavedSearch(me.id, searchId, tx));
  revalidatePath("/account");
  revalidatePath("/account/saved-searches");
}

type SavedSearchRow = Awaited<ReturnType<typeof listOwnerSavedSearches>>[number];

function savedSearchHref(search: SavedSearchRow) {
  const params = new URLSearchParams();
  if (search.query) params.set("q", search.query);
  if (search.category) params.set("category", search.category);
  if (search.listingType) params.set("type", search.listingType);
  if (search.shipsWithinDays != null) params.set("ships", String(search.shipsWithinDays));
  if (search.minRating != null) params.set("rating", String(search.minRating));
  if (search.lat != null && search.lng != null && search.radiusMiles != null) {
    params.set("lat", String(search.lat));
    params.set("lng", String(search.lng));
    params.set("radius", String(search.radiusMiles));
  }
  if (search.sort) params.set("sort", search.sort);
  if (search.minPrice != null) params.set("min", formatCurrencyMinorUnitAmount(search.minPrice));
  if (search.maxPrice != null) params.set("max", formatCurrencyMinorUnitAmount(search.maxPrice));
  for (const tag of search.tags) params.append("tag", tag);
  return `/browse?${params.toString()}`;
}

function savedSearchLabel(search: SavedSearchRow) {
  const parts: string[] = [];
  if (search.query) parts.push(`"${search.query}"`);
  if (search.category) parts.push(search.category.charAt(0) + search.category.slice(1).toLowerCase());
  if (search.listingType) parts.push(search.listingType === "IN_STOCK" ? "In stock" : "Made to order");
  if (search.shipsWithinDays != null) parts.push(`ships within ${search.shipsWithinDays}d`);
  if (search.minRating != null) parts.push(`${search.minRating} star+`);
  if (search.minPrice != null) parts.push(`${formatCurrencyCents(search.minPrice)}+`);
  if (search.maxPrice != null) parts.push(`up to ${formatCurrencyCents(search.maxPrice)}`);
  if (search.lat != null && search.lng != null && search.radiusMiles != null) parts.push(`within ${search.radiusMiles} mi`);
  if (search.tags.length > 0) parts.push(search.tags.map((tag) => `#${tag}`).join(" "));
  return parts.length > 0 ? parts.join(" · ") : "All listings";
}

export default async function AccountSavedSearchesPage() {
  const me = await ensureUserForPage("/account/saved-searches");
  const searches = await withDbUserContext(me.id, (tx) => listOwnerSavedSearches(me.id, tx));

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Link href="/account" className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700">
        ← My Account
      </Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-neutral-900">Saved Searches</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Revisit filters you saved from Browse.
          </p>
        </div>
        <Link
          href="/browse"
          className="inline-flex min-h-10 w-fit items-center rounded-md border border-neutral-900 bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
        >
          Browse listings
        </Link>
      </div>

      {searches.length === 0 ? (
        <section className="card-section p-8 text-center">
          <p className="text-sm text-neutral-600">
            No saved searches yet. Save useful filters from Browse to come back to them quickly.
          </p>
        </section>
      ) : (
        <ul className="space-y-3">
          {searches.map((search) => {
            const href = savedSearchHref(search);
            return (
              <li key={search.id} className="card-section p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Link href={href} className="text-sm font-semibold text-neutral-900 hover:underline">
                      {savedSearchLabel(search)}
                    </Link>
                    <p className="mt-1 text-xs text-neutral-500">
                      Saved {search.createdAt.toLocaleDateString("en-US")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={href}
                      className="inline-flex min-h-[36px] items-center rounded-md border border-neutral-200 bg-white px-3 py-1 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
                    >
                      Browse
                    </Link>
                    <form action={deleteSavedSearch.bind(null, search.id)}>
                      <button className="inline-flex min-h-[36px] items-center rounded-md border border-red-200 bg-white px-3 py-1 text-sm font-medium text-red-700 transition-colors hover:bg-red-50">
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
