import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

type Params = { listingId: string };

export async function DELETE(_req: Request, ctx: { params: Promise<Params> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { listingId } = await ctx.params;
  if (!listingId) return NextResponse.json({ error: "listingId required" }, { status: 400 });

  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) {
    console.error("DELETE /api/favorites user not found in DB:", { clerkId: userId, listingId });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("DELETE /api/favorites:", { listingId, dbUserId: me.id, role: me.role });

  try {
    await prisma.favorite.deleteMany({ where: { userId: me.id, listingId } });
  } catch (e) {
    console.error("DELETE /api/favorites deleteMany error:", {
      message: (e as Error).message,
      listingId,
      dbUserId: me.id,
    });
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
