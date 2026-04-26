import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";

export const runtime = "nodejs";

function pruneReadNotificationsHourly() {
  const now = new Date();
  if (now.getMinutes() !== 0) return;

  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  void prisma.notification
    .deleteMany({
      where: {
        read: true,
        createdAt: { lt: cutoff },
      },
    })
    .catch((error) => {
      console.error("[notifications] prune failed:", error);
    });
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  pruneReadNotificationsHourly();

  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    if (isAccountAccessError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }

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
