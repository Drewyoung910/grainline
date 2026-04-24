import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { CommissionStatus } from "@prisma/client";
import { verifyCronRequest } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await prisma.commissionRequest.updateMany({
      where: {
        status: CommissionStatus.OPEN,
        expiresAt: { lte: new Date() },
      },
      data: { status: CommissionStatus.EXPIRED },
    });

    return NextResponse.json({ ok: true, expired: result.count });
  } catch (error) {
    console.error("[commission-expire cron] Error:", error);
    Sentry.captureException(error, { tags: { source: "cron_commission_expire" } });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
