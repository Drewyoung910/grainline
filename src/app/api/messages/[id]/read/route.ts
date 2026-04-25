import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

  const me = await ensureUserByClerkId(userId);

  // Ensure I’m a participant
  const convo = await prisma.conversation.findFirst({
    where: { id, OR: [{ userAId: me.id }, { userBId: me.id }] },
    select: { id: true },
  });
  if (!convo) return NextResponse.json({ ok: false }, { status: 403 });

  await prisma.message.updateMany({
    where: { conversationId: id, recipientId: me.id, readAt: null },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
