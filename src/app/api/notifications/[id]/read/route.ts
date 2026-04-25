import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { markReadRatelimit, safeRateLimitOpen } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await safeRateLimitOpen(markReadRatelimit, userId);
  if (!success) return NextResponse.json({ ok: true });

  const me = await ensureUserByClerkId(userId);

  await prisma.notification.updateMany({
    where: { id, userId: me.id },
    data: { read: true },
  });

  return NextResponse.json({ ok: true });
}
