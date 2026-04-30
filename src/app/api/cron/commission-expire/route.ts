import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { CommissionStatus } from "@prisma/client";
import { verifyCronRequest } from "@/lib/cronAuth";
import { createNotification } from "@/lib/notifications";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";
import { mapWithConcurrency } from "@/lib/concurrency";

export const runtime = "nodejs";
export const maxDuration = 60;

const COMMISSION_INTEREST_NOTIFY_LIMIT = 10000;
const COMMISSION_EXPIRE_BATCH_SIZE = 200;
const COMMISSION_EXPIRE_MAX_BATCHES = 5;
const COMMISSION_EXPIRE_REQUEST_CONCURRENCY = 5;

function cronErrorCode(error: unknown) {
  const err = error as { code?: string; name?: string };
  return err.code ?? err.name ?? "UNKNOWN";
}

export async function GET(req: Request) {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cronRun = await beginCronRun("commission-expire");
  if (!cronRun.acquired) return NextResponse.json(skippedCronRunResponse(cronRun));

  try {
    const now = new Date();
    let expired = 0;
    let checked = 0;
    let batches = 0;
    let lastBatchFull = false;
    const checkedIds: string[] = [];
    const failures: Array<{ requestId: string; code: string }> = [];

    for (let batch = 0; batch < COMMISSION_EXPIRE_MAX_BATCHES; batch += 1) {
      const expiring = await prisma.commissionRequest.findMany({
        where: {
          status: CommissionStatus.OPEN,
          expiresAt: { lte: now },
          ...(checkedIds.length > 0 ? { id: { notIn: checkedIds } } : {}),
        },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: COMMISSION_EXPIRE_BATCH_SIZE,
        select: {
          id: true,
          title: true,
          buyerId: true,
          interests: {
            where: {
              sellerProfile: {
                user: { banned: false, deletedAt: null },
              },
            },
            take: COMMISSION_INTEREST_NOTIFY_LIMIT,
            select: {
              sellerProfile: { select: { userId: true } },
            },
          },
        },
      });
      if (expiring.length === 0) {
        lastBatchFull = false;
        break;
      }

      batches += 1;
      checked += expiring.length;
      checkedIds.push(...expiring.map((request) => request.id));
      lastBatchFull = expiring.length === COMMISSION_EXPIRE_BATCH_SIZE;

      await mapWithConcurrency(expiring, COMMISSION_EXPIRE_REQUEST_CONCURRENCY, async (request) => {
        try {
          const updated = await prisma.commissionRequest.updateMany({
            where: { id: request.id, status: CommissionStatus.OPEN },
            data: { status: CommissionStatus.EXPIRED },
          });
          if (updated.count === 0) return;
          expired += 1;

          const title = request.title.slice(0, 80);
          const sellerUserIds = Array.from(
            new Set(request.interests.map((i) => i.sellerProfile.userId).filter(Boolean)),
          );
          await createNotification({
            userId: request.buyerId,
            type: "COMMISSION_INTEREST",
            title: "Commission request expired",
            body: `"${title}" is now closed to new maker interest.`,
            link: `/commission/${request.id}`,
            dedupScope: request.id,
          });
          await mapWithConcurrency(sellerUserIds, 10, (userId) =>
            createNotification({
              userId,
              type: "COMMISSION_INTEREST",
              title: "Commission request expired",
              body: `"${title}" is no longer accepting interest.`,
              link: `/commission/${request.id}`,
              dedupScope: request.id,
            }),
          );
        } catch (error) {
          const code = cronErrorCode(error);
          failures.push({ requestId: request.id, code });
          Sentry.captureException(error, {
            tags: { source: "cron_commission_expire_record", code },
            extra: { requestId: request.id },
          });
        }
      });

      if (!lastBatchFull) {
        break;
      }
    }

    const remainingOpenExpired = lastBatchFull
      ? await prisma.commissionRequest.count({
          where: {
            status: CommissionStatus.OPEN,
            expiresAt: { lte: now },
            ...(checkedIds.length > 0 ? { id: { notIn: checkedIds } } : {}),
          },
        })
      : 0;
    const hasMore = remainingOpenExpired > 0;

    const response = { ok: true, expired, checked, batches, hasMore, failures };
    await completeCronRun(cronRun, response);
    return NextResponse.json(response);
  } catch (error) {
    await failCronRun(cronRun, error);
    console.error("[commission-expire cron] Error:", error);
    Sentry.captureException(error, { tags: { source: "cron_commission_expire" } });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
