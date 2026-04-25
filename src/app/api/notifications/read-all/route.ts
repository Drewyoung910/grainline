import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { markReadRatelimit, safeRateLimitOpen } from "@/lib/ratelimit";
import { ensureUserByClerkId } from "@/lib/ensureUser";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success } = await safeRateLimitOpen(markReadRatelimit, userId);
  if (!success) return NextResponse.json({ ok: true }); // Silently succeed — non-critical

  const me = await ensureUserByClerkId(userId);

  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((id: unknown): id is string => typeof id === "string").slice(0, 100)
    : [];

  await prisma.notification.updateMany({
    where: {
      userId: me.id,
      read: false,
      ...(ids.length > 0 ? { id: { in: ids } } : {}),
    },
    data: { read: true },
  });

  return NextResponse.json({ ok: true });
}
