// POST { type: string, enabled: boolean }
// Auth required
// Updates user.notificationPreferences JSON field
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { type, enabled } = await request.json();
  if (!type || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, notificationPreferences: true },
  });
  if (!me) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const prefs = (me.notificationPreferences as Record<string, boolean>) ?? {};
  prefs[type] = enabled;

  await prisma.user.update({
    where: { id: me.id },
    data: { notificationPreferences: prefs },
  });

  return NextResponse.json({ ok: true });
}
