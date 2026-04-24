import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureUser } from "@/lib/ensureUser";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const me = await ensureUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: blockedId } = await params;
  if (blockedId === me.id) return NextResponse.json({ error: "Cannot block yourself" }, { status: 400 });

  await prisma.block.upsert({
    where: { blockerId_blockedId: { blockerId: me.id, blockedId } },
    create: { blockerId: me.id, blockedId },
    update: {},
  });

  // Remove reciprocal Follow rows (both directions)
  try {
    // If I follow their seller profile, remove
    const blockedSeller = await prisma.sellerProfile.findUnique({ where: { userId: blockedId }, select: { id: true } });
    if (blockedSeller) {
      await prisma.follow.deleteMany({ where: { followerId: me.id, sellerProfileId: blockedSeller.id } });
    }
    // If they follow my seller profile, remove
    const mySeller = await prisma.sellerProfile.findUnique({ where: { userId: me.id }, select: { id: true } });
    if (mySeller) {
      await prisma.follow.deleteMany({ where: { followerId: blockedId, sellerProfileId: mySeller.id } });
    }
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, blocked: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const me = await ensureUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: blockedId } = await params;

  await prisma.block.deleteMany({
    where: { blockerId: me.id, blockedId },
  });

  return NextResponse.json({ ok: true, blocked: false });
}
