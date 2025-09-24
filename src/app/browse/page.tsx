import Link from "next/link";
import { prisma } from "@/lib/db";
import { ListingStatus } from "@prisma/client";

type PageProps = {
  // Next 15 passes searchParams as an async prop; await it once
  searchParams: Promise<{ q?: string; page?: string }>;
};

export default async function BrowsePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const q = (sp?.q ?? "").toString().trim();
  const page = Math.max(1, Number(sp?.page ?? 1) || 1);
  const PAGE_SIZE = 12;

  const where = {
    status: ListingStatus.ACTIVE,
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, listings] = await Promise.all([
    prisma.listing.count({ where }),
    prisma.listing.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      include: {
        photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // helpers to build Prev/Next links
  const buildQS = (p: number) => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    qs.set("page", String(p));
    return qs.toString();
  };

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Browse</h1>

      <form className="mb-6">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search listings…"
          className="w-full max-w-md border rounded px-3 py-2"
        />
      </form>

      <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {listings.map((l) => {
          const img = l.photos[0]?.url ?? "/favicon.ico";
          return (
            <li key={l.id} className="border rounded-xl overflow-hidden">
              <Link href={`/listing/${l.id}`} className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt={l.title} src={img} className="w-full h-48 object-cover" />
                <div className="p-4">
                  <div className="font-medium">{l.title}</div>
                  <div className="opacity-70">${(l.priceCents / 100).toFixed(2)}</div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-3 mt-8">
        <Link
          href={`/browse?${buildQS(Math.max(1, page - 1))}`}
          className={`border rounded px-3 py-1 ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
        >
          ← Prev
        </Link>
        <span className="text-sm opacity-70">
          Page {page} of {totalPages}
        </span>
        <Link
          href={`/browse?${buildQS(Math.min(totalPages, page + 1))}`}
          className={`border rounded px-3 py-1 ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`}
        >
          Next →
        </Link>
      </div>
    </main>
  );
}
