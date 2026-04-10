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
