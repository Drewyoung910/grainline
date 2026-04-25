import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { CommissionStatus } from "@prisma/client";
import { verifyCronRequest } from "@/lib/cronAuth";
import { createNotification } from "@/lib/notifications";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const expiring = await prisma.commissionRequest.findMany({
      where: {
        status: CommissionStatus.OPEN,
        expiresAt: { lte: new Date() },
      },
      take: 200,
      select: {
        id: true,
        title: true,
        buyerId: true,
        interests: {
          select: {
            sellerProfile: { select: { userId: true } },
          },
        },
      },
    });

    let expired = 0;
    for (const request of expiring) {
      const updated = await prisma.commissionRequest.updateMany({
        where: { id: request.id, status: CommissionStatus.OPEN },
        data: { status: CommissionStatus.EXPIRED },
      });
      if (updated.count === 0) continue;
      expired += 1;

      const title = request.title.slice(0, 80);
      const sellerUserIds = Array.from(
        new Set(request.interests.map((i) => i.sellerProfile.userId).filter(Boolean)),
      );
      await Promise.allSettled([
        createNotification({
          userId: request.buyerId,
          type: "COMMISSION_INTEREST",
          title: "Commission request expired",
          body: `"${title}" is now closed to new maker interest.`,
          link: `/commission/${request.id}`,
        }),
        ...sellerUserIds.map((userId) =>
          createNotification({
            userId,
            type: "COMMISSION_INTEREST",
            title: "Commission request expired",
            body: `"${title}" is no longer accepting interest.`,
            link: `/commission/${request.id}`,
          }),
        ),
      ]);
    }

    return NextResponse.json({ ok: true, expired, checked: expiring.length });
  } catch (error) {
    console.error("[commission-expire cron] Error:", error);
    Sentry.captureException(error, { tags: { source: "cron_commission_expire" } });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
