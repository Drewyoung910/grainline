import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.notification.updateMany({
    where: { id, userId: me.id },
    data: { read: true },
  });

  return NextResponse.json({ ok: true });
}
