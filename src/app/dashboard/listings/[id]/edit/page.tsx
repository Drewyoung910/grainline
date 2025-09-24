// src/app/dashboard/listings/[id]/edit/page.tsx
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import { revalidatePath } from "next/cache";
import ImagesUploader from "@/components/ImagesUploader";

async function updateListing(id: string, formData: FormData) {
  "use server";

  const { userId } = await auth();
  if (!userId) redirect(`/sign-in?redirect_url=/dashboard/listings/${id}/edit`);

  const { seller } = await ensureSeller();

  // Ensure this listing belongs to the signed-in seller
  const owned = await prisma.listing.findFirst({
    where: { id, sellerId: seller.id },
    select: { id: true },
  });
  if (!owned) return notFound();

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const priceStr = String(formData.get("price") ?? "0");
  const priceCents = Math.round(parseFloat(priceStr) * 100);

  const imageUrls = formData.getAll("imageUrls").map(String).slice(0, 8);
  if (!title || !Number.isFinite(priceCents) || priceCents <= 0 || imageUrls.length === 0) {
    throw new Error("Please provide title, price and at least one photo.");
  }

  await prisma.$transaction([
    prisma.listing.update({
      where: { id },
      data: { title, description, priceCents },
    }),
    prisma.photo.deleteMany({ where: { listingId: id } }),
    prisma.photo.createMany({
      data: imageUrls.map((url, i) => ({ listingId: id, url, sortOrder: i })),
    }),
  ]);

  revalidatePath("/dashboard");
  revalidatePath("/browse");
  redirect(`/listing/${id}`);
}

export default async function EditListingPage({
  params,
}: {
  params: { id: string };
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard");

  // Make sure the current user owns the listing
  const { seller } = await ensureSeller();

  const listing = await prisma.listing.findFirst({
    where: { id: params.id, sellerId: seller.id },
    include: { photos: { orderBy: { sortOrder: "asc" } } },
  });
  if (!listing) return notFound();

  const initialUrls = listing.photos.map((p) => p.url);

  return (
    <main className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-6">Edit listing</h1>

      <form action={updateListing.bind(null, listing.id)} className="space-y-4">
        <div>
          <label className="block text-sm mb-1">Title</label>
          <input
            name="title"
            defaultValue={listing.title}
            required
            className="w-full border rounded px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Price (USD)</label>
          <input
            name="price"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={(listing.priceCents / 100).toFixed(2)}
            className="w-full border rounded px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Photos</label>
          <ImagesUploader max={8} fieldName="imageUrls" initialUrls={initialUrls} />
        </div>

        <div>
          <label className="block text-sm mb-1">Description</label>
          <textarea
            name="description"
            rows={4}
            defaultValue={listing.description ?? ""}
            className="w-full border rounded px-3 py-2"
          />
        </div>

        <button type="submit" className="rounded px-4 py-2 bg-black text-white">Save changes</button>
      </form>
    </main>
  );
}
