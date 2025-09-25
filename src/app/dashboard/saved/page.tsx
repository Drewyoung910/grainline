// src/app/dashboard/saved/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import FavoriteButton from "@/components/FavoriteButton";

const PAGE_SIZE = 24;

type Search = { page?: string };

async function unsave(listingId: string) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true },
  });
  if (!me) return;

  // composite PK (userId, listingId)
  await prisma.favorite.delete({
    where: { userId_listingId: { userId: me.id, listingId } },
  });

  revalidatePath("/dashboard/saved");
}

export default async function SavedPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/saved");

  const { page = "1" } = await searchParams;
  const pageNum = Math.max(1, Number.parseInt(page || "1", 10));

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true },
  });
  if (!me) redirect("/");

  const [favs, total] = await Promise.all([
    prisma.favorite.findMany({
      where: { userId: me.id },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
      include: {
        listing: {
          include: {
            photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
            seller: { include: { user: true } },
          },
        },
      },
    }),
    prisma.favorite.count({ where: { userId: me.id } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const makeHref = (n: number) => {
    const p = new URLSearchParams();
    p.set("page", String(n));
    return `/dashboard/saved?${p.toString()}`;
  };

  return (
    <main className="max-w-6xl mx-auto p-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Saved items</h1>
          <p className="text-sm text-neutral-500 mt-1">
            You have <span className="font-medium">{total}</span> saved item{total === 1 ? "" : "s"}.
          </p>
        </div>

        <nav className="flex items-center gap-2 text-sm">
          {pageNum > 1 ? (
            <Link href={makeHref(pageNum - 1)} className="rounded border px-3 py-1 hover:bg-neutral-50">← Prev</Link>
          ) : (
            <span className="rounded border px-3 py-1 text-neutral-400">← Prev</span>
          )}
          {totalPages > 1 && (
            <span className="px-2 text-neutral-500">
              Page <span className="font-medium">{pageNum}</span> of {totalPages}
            </span>
          )}
          {pageNum < totalPages ? (
            <Link href={makeHref(pageNum + 1)} className="rounded border px-3 py-1 hover:bg-neutral-50">Next →</Link>
          ) : (
            <span className="rounded border px-3 py-1 text-neutral-400">Next →</span>
          )}
        </nav>
      </header>

      {favs.length === 0 ? (
        <div className="rounded-xl border p-8 text-neutral-600">
          Nothing saved yet. Head to <Link href="/browse" className="underline">Browse</Link> and tap the heart ♥.
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {favs.map((f) => {
            const l = f.listing;
            const img = l.photos[0]?.url ?? "/favicon.ico";
            const sellerName = l.seller.displayName ?? l.seller.user?.email ?? "Seller";

            return (
              <li key={`${f.userId}-${l.id}`} className="border rounded-xl overflow-hidden">
                <div className="relative">
                  <Link href={`/listing/${l.id}`} className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt={l.title} src={img} className="w-full h-48 object-cover" />
                  </Link>
                  <div className="absolute top-2 right-2">
                    <FavoriteButton listingId={l.id} initialSaved={true} />
                  </div>
                </div>

                <Link href={`/listing/${l.id}`} className="block">
                  <div className="p-4 space-y-2">
                    <div className="flex items-baseline justify-between">
                      <div className="font-medium">{l.title}</div>
                      <div className="opacity-70">${(l.priceCents / 100).toFixed(2)}</div>
                    </div>
                    <div className="text-xs text-neutral-500">by {sellerName}</div>
                  </div>
                </Link>

                <div className="px-4 pb-4">
                  <form action={unsave.bind(null, l.id)}>
                    <button className="text-xs rounded border px-3 py-1 hover:bg-neutral-50">
                      Remove
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
