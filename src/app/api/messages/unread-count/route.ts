// src/app/api/messages/unread-count/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { ensureUserByClerkId } from "@/lib/ensureUser";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ count: 0 });

    let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
    try {
      me = await ensureUserByClerkId(userId);
    } catch (err) {
      const accountResponse = accountAccessErrorResponse(err);
      if (accountResponse) return accountResponse;
      throw err;
    }

    const count = await prisma.message.count({
      where: { recipientId: me.id, readAt: null },
    });

    return NextResponse.json({ count });
  } catch {
    // Don’t explode the header—just show 0 on error
    return NextResponse.json({ count: 0 });
  }
}
