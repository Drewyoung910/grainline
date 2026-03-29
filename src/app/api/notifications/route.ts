import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: me.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.notification.count({ where: { userId: me.id, read: false } }),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}
