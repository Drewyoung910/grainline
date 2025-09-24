// src/app/dashboard/listings/new/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import ImagesUploader from "@/components/ImagesUploader";

async function createListing(formData: FormData) {
  "use server";

  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/listings/new");

  const { seller } = await ensureSeller();

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const priceStr = String(formData.get("price") ?? "0");
  const priceCents = Math.round(parseFloat(priceStr) * 100);

  // Gather up to 8 image URLs that the client component posted
  const imageUrls = formData.getAll("imageUrls").map(String).slice(0, 8);

  if (!title || !imageUrls.length || !Number.isFinite(priceCents) || priceCents <= 0) {
    throw new Error("Please fill title, price, and upload at least one photo.");
  }

  const created = await prisma.listing.create({
    data: {
      sellerId: seller.id,
      title,
      description,
      priceCents,
      photos: { create: imageUrls.map((url, i) => ({ url, sortOrder: i })) },
    },
  });

  revalidatePath("/browse");
  revalidatePath("/dashboard");
  redirect(`/listing/${created.id}`);
}

export default async function NewListingPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/listings/new");

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-6">Create a listing</h1>

      <form action={createListing} className="space-y-4">
        <div>
          <label className="block text-sm mb-1">Title</label>
          <input name="title" required className="w-full border rounded px-3 py-2" />
        </div>

        <div>
          <label className="block text-sm mb-1">Price (USD)</label>
          <input name="price" type="number" step="0.01" min="0" required className="w-full border rounded px-3 py-2" />
        </div>

        <div>
          <label className="block text-sm mb-1">Photos</label>
          <ImagesUploader max={8} fieldName="imageUrls" />
        </div>

        <div>
          <label className="block text-sm mb-1">Description</label>
          <textarea name="description" rows={4} className="w-full border rounded px-3 py-2" />
        </div>

        <button type="submit" className="rounded px-4 py-2 bg-black text-white">Create</button>
      </form>
    </div>
  );
}





