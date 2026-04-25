// src/app/api/messages/unread-count/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ count: 0 });

    const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    if (!me) return NextResponse.json({ count: 0 });

    const count = await prisma.message.count({
      where: { recipientId: me.id, readAt: null },
    });

    return NextResponse.json({ count });
  } catch {
    // Don’t explode the header—just show 0 on error
    return NextResponse.json({ count: 0 });
  }
}
