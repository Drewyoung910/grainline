"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import { listingEditBlockReason } from "@/lib/listingEditState";
import { sanitizeRichText, sanitizeText } from "@/lib/sanitize";
import { isR2PublicUrl } from "@/lib/urlValidation";

export async function updateListingAction(listingId: string, formData: FormData) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard");

  const { me } = await ensureSeller();

  const title = sanitizeText(String(formData.get("title") ?? "").trim()).slice(0, 150);
  const description = sanitizeRichText(String(formData.get("description") ?? "").trim()).slice(0, 5000);
  const priceStr = (formData.get("price") as string) || "0";
  const imageUrl = String(formData.get("imageUrl") ?? "").trim();
  const priceCents = Math.round(parseFloat(priceStr) * 100);

  if (!title || !imageUrl || !isR2PublicUrl(imageUrl) || !Number.isFinite(priceCents) || priceCents <= 0) {
    throw new Error("Please fill title, price and image.");
  }

  // Ensure the listing belongs to the signed-in user
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, seller: { userId: me.id } },
    include: { photos: { orderBy: { sortOrder: "asc" }, take: 1 } },
  });
  if (!listing) redirect("/dashboard");
  const blockReason = listingEditBlockReason(listing);
  if (blockReason) throw new Error(blockReason);

  await prisma.$transaction(async (tx) => {
    await tx.listing.update({
      where: { id: listingId },
      data: { title, description, priceCents },
    });

    const firstPhoto = listing.photos[0];
    if (firstPhoto) {
      await tx.photo.update({
        where: { id: firstPhoto.id },
        data: { url: imageUrl },
      });
    } else {
      await tx.photo.create({
        data: { listingId, url: imageUrl, sortOrder: 0 },
      });
    }
  });

  revalidatePath("/dashboard");
  revalidatePath(`/listing/${listingId}`);
  // Let the caller decide where to redirect.
}
