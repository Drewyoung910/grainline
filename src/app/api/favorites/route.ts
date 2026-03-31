// src/app/api/favorites/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUser } from "@/lib/ensureUser";
import { createNotification } from "@/lib/notifications";
import { saveRatelimit, rateLimitResponse } from "@/lib/ratelimit";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success: rlOk, reset } = await saveRatelimit.limit(userId);
  if (!rlOk) return rateLimitResponse(reset, "Too many save actions.");

  let listingId: string;
  try {
    const body = await req.json();
    listingId = body?.listingId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!listingId || typeof listingId !== "string") {
    return NextResponse.json({ error: "listingId required" }, { status: 400 });
  }

  let me;
  try {
    me = await ensureUser();
  } catch (e) {
    console.error("POST /api/favorites ensureUser error:", { error: (e as Error).message, userId });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  console.log("POST /api/favorites:", { listingId, dbUserId: me.id, role: me.role });

  try {
    await prisma.favorite.upsert({
      where: { userId_listingId: { userId: me.id, listingId } },
      update: {},
      create: { userId: me.id, listingId },
    });
  } catch (e) {
    console.error("POST /api/favorites upsert error:", {
      message: (e as Error).message,
      listingId,
      dbUserId: me.id,
    });
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  // Notify listing owner (non-fatal)
  try {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      select: { title: true, seller: { select: { userId: true } } },
    });
    const ownerUserId = listing?.seller?.userId;
    console.log("POST /api/favorites notify lookup:", { ownerUserId, isSelf: ownerUserId === me.id, hasListing: !!listing, hasSeller: !!listing?.seller });
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
    console.error("POST /api/favorites notification error (non-fatal):", (e as Error).message);
  }

  return NextResponse.json({ ok: true });
}
