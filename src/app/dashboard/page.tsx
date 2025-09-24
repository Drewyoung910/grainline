// src/app/dashboard/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import { ListingStatus } from "@prisma/client";
import ConfirmButton from "@/components/ConfirmButton";

// Server action: set status (Active / Hidden / Sold)
async function setStatus(listingId: string, nextStatus: ListingStatus) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;

  // ensure ownership
  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) return;

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { seller: true },
  });
  if (!listing || listing.seller.userId !== me.id) return;

  await prisma.listing.update({
    where: { id: listingId },
    data: { status: nextStatus },
  });

  revalidatePath("/dashboard");
  revalidatePath("/browse");
}

// Server action: delete listing
async function deleteListing(listingId: string) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;

  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) return;

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { seller: true },
  });
  if (!listing || listing.seller.userId !== me.id) return;

  await prisma.listing.delete({ where: { id: listingId } });

  revalidatePath("/dashboard");
  revalidatePath("/browse");
}

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
        <h1 className="text-4xl font-bold">
          Welcome, {me.name ?? me.email.split("@")[0]} 👋
        </h1>
        <p className="text-neutral-600 mt-2">Signed in as {me.email}</p>

        <div className="mt-6 flex gap-3">
          <Link
            href="/dashboard/listings/new"
            className="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-medium shadow-sm hover:bg-neutral-50"
          >
            + Create listing
          </Link>
          <Link
            href="/dashboard/seller"
            className="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-medium hover:bg-neutral-50"
          >
            Edit seller profile
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
            You don’t have any listings yet. Click <b>Create listing</b> to get
            started.
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {listings.map((l) => {
              const thumb = l.photos[0]?.url;
              const hideAction =
                l.status === "HIDDEN"
                  ? setStatus.bind(null, l.id, ListingStatus.ACTIVE)
                  : setStatus.bind(null, l.id, ListingStatus.HIDDEN);

              return (
                <li key={l.id} className="overflow-hidden rounded-xl border">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb}
                      alt={l.title}
                      className="h-48 w-full object-cover"
                    />
                  ) : (
                    <div className="h-48 w-full bg-neutral-100" />
                  )}

                  <div className="p-4 space-y-2">
                    <div className="flex items-baseline justify-between">
                      <h3 className="font-medium">{l.title}</h3>
                      <span className="text-sm text-neutral-500">
                        {(l.priceCents / 100).toLocaleString(undefined, {
                          style: "currency",
                          currency: l.currency,
                        })}
                      </span>
                    </div>

                    <div className="text-xs uppercase tracking-wide text-neutral-500">
                      {l.status}
                    </div>

                    <div className="pt-3 flex flex-wrap gap-2">
                      <Link
                        href={`/dashboard/listings/${l.id}/edit`}
                        className="text-xs rounded border px-2 py-1 hover:bg-neutral-50"
                      >
                        Edit
                      </Link>

                      <form action={setStatus.bind(null, l.id, ListingStatus.SOLD)}>
                        <button className="text-xs rounded border px-2 py-1 hover:bg-neutral-50">
                          Mark sold
                        </button>
                      </form>

                      <form action={hideAction}>
                        <button className="text-xs rounded border px-2 py-1 hover:bg-neutral-50">
                          {l.status === "HIDDEN" ? "Unhide" : "Hide"}
                        </button>
                      </form>

                      <form action={deleteListing.bind(null, l.id)}>
                        <ConfirmButton
                          confirm="Delete this listing?"
                          className="text-xs rounded border px-2 py-1 hover:bg-red-50 text-red-600 border-red-300"
                        >
                          Delete
                        </ConfirmButton>
                      </form>
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













