// src/app/api/messages/[id]/list/route.ts
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true },
  });
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });

  // Only if I’m in this conversation
  const belongs = await prisma.conversation.findFirst({
    where: { id, OR: [{ userAId: me.id }, { userBId: me.id }] },
    select: { id: true },
  });
  if (!belongs) return NextResponse.json({ ok: false }, { status: 403 });

  const url = new URL(req.url);
  const since = url.searchParams.get("since");
  const sinceDate =
    since && !Number.isNaN(Number(since))
      ? new Date(Number(since))
      : null;

  const messages = await prisma.message.findMany({
    where: {
      conversationId: id,
      ...(sinceDate ? { createdAt: { gt: sinceDate } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      senderId: true,
      recipientId: true,
      body: true,
      kind: true,
      createdAt: true,
      readAt: true,
    },
  });

  return NextResponse.json({ ok: true, messages });
}
