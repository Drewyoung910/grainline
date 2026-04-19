// src/app/actions/toggleFavorite.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";

export async function toggleFavorite(listingId: string) {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) return { ok: false, error: "User not found in DB" };

  const key = { userId: me.id, listingId };

  // --- Part 1: toggle the favorite record ---
  let existing;
  try {
    existing = await prisma.favorite.findUnique({
      where: { userId_listingId: key },
    });
  } catch (e) {
    console.error("toggleFavorite error finding existing favorite:", e);
    return { ok: false, error: "DB error checking favorite" };
  }

  try {
    if (existing) {
      await prisma.favorite.delete({ where: { userId_listingId: key } });
    } else {
      await prisma.favorite.create({ data: key });
    }
  } catch (e) {
    console.error("toggleFavorite error toggling favorite record:", e);
    return { ok: false, error: "DB error toggling favorite" };
  }

  // --- Part 2: notify the listing owner (non-fatal) ---
  if (!existing) {
    try {
      const listing = await prisma.listing.findUnique({
        where: { id: listingId },
        select: {
          title: true,
          seller: {
            select: {
              userId: true,
            },
          },
        },
      });
      const ownerUserId = listing?.seller?.userId;
      if (ownerUserId && ownerUserId !== me.id) {
        const favName = me.name ?? me.email?.split("@")[0] ?? "Someone";
        await createNotification({
          userId: ownerUserId,
          type: "NEW_FAVORITE",
          title: `${favName} hearted your listing`,
          body: listing!.title,
          link: `/listing/${listingId}`,
        });
      }
    } catch (e) {
      // notification failure must not break the favorite toggle
      console.error("toggleFavorite error sending notification (non-fatal):", e);
    }
  }

  revalidatePath("/browse");
  revalidatePath(`/listing/${listingId}`);
  return { ok: true };
}
