import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { markReadRatelimit, safeRateLimitOpen } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await safeRateLimitOpen(markReadRatelimit, userId);
  if (!success) return NextResponse.json({ ok: true }); // Silently succeed — non-critical

  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.notification.updateMany({
    where: { userId: me.id, read: false },
    data: { read: true },
  });

  return NextResponse.json({ ok: true });
}
