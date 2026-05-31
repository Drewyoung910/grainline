// src/app/api/cron/guild-metrics/route.ts
// Monthly cron — runs 1st of every month at 15:40 UTC.
// Recalculates metrics for all Guild Members and Guild Masters;
// enforces a minimum 30-day warning window before Guild Master revocation.

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import {
  calculateSellerMetrics,
  meetsGuildMasterRequirements,
  GUILD_MASTER_REQUIREMENTS,
  listingViewDailyRetentionCutoff,
} from "@/lib/metrics";
import { createNotification } from "@/lib/notifications";
import {
  sendGuildMasterWarningEmail,
  sendGuildMasterRevokedEmail,
} from "@/lib/email";
import { verifyCronRequest } from "@/lib/cronAuth";
import { withSentryCronMonitor } from "@/lib/cronMonitor";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";
import { revalidateFeaturedMakerCaches } from "@/lib/searchCache";
import { logSystemAction, logSystemActionOrThrow } from "@/lib/systemAudit";
import { formatCurrencyCents } from "@/lib/money";
import {
  GUILD_MASTER_REVOKABLE_VERIFICATION_STATUSES,
  assertGuildVerificationTransition,
  isGuildVerificationTransitionConflict,
} from "@/lib/guildVerificationState";
import { runBoundedDeletionBatches, runCronCursorPages } from "@/lib/cronBatchState";

export const runtime = "nodejs";
export const maxDuration = 300; // 5-minute limit for large seller sets

const SELLER_PAGE_SIZE = 50;
const SELLER_PROCESS_CONCURRENCY = 3;
const VIEW_CLEANUP_BATCH_SIZE = 1000;
const VIEW_CLEANUP_TIME_BUDGET_MS = 60_000;
const GUILD_MASTER_WARNING_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return withSentryCronMonitor("guild-metrics", { value: "40 15 1 * *", maxRuntimeMinutes: 5 }, async () => {
    const cronRun = await beginCronRun("guild-metrics");
    if (!cronRun.acquired) return NextResponse.json(skippedCronRunResponse(cronRun));

    try {
      const response = await runGuildMetricsCron();
      await completeCronRun(cronRun, response);
      return NextResponse.json(response);
    } catch (error) {
      await failCronRun(cronRun, error);
      Sentry.captureException(error, { tags: { source: "cron_guild_metrics" } });
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  });
}

async function runGuildMetricsCron() {
  let processed = 0;
  let warned = 0;
  let revokedMaster = 0;
  const errors: Array<{ sellerId: string; code: string }> = [];

  await runCronCursorPages({
    pageSize: SELLER_PAGE_SIZE,
    fetchPage: fetchGuildSellerBatch,
    getCursor: (seller) => seller.id,
    processPage: async (sellers) => {
      for (let i = 0; i < sellers.length; i += SELLER_PROCESS_CONCURRENCY) {
        const batch = sellers.slice(i, i + SELLER_PROCESS_CONCURRENCY);
        const outcomes = await Promise.all(
          batch.map(async (seller) => {
            try {
              return await processGuildSeller(seller);
            } catch (err) {
              const code = getErrorCode(err);
              errors.push({ sellerId: seller.id, code });
              Sentry.captureException(err, { tags: { source: "cron_guild_metrics", sellerId: seller.id, code } });
              return null;
            }
          }),
        );

        for (const outcome of outcomes) {
          if (!outcome) continue;
          processed += outcome.processed;
          warned += outcome.warned;
          revokedMaster += outcome.revokedMaster;
        }
      }
    },
  });

  // Clean up view daily records older than the fixed retention window.
  const twoYearsAgo = listingViewDailyRetentionCutoff();
  let deletedViewRows = 0;
  let deletedViewRowsComplete = true;
  try {
    const viewCleanup = await deleteOldListingViewDaily(twoYearsAgo);
    deletedViewRows = viewCleanup.count;
    deletedViewRowsComplete = viewCleanup.complete;
    if (deletedViewRows > 0) {
      await logSystemAction({
        actorType: "cron",
        actorId: "guild-metrics",
        action: "PRUNE_LISTING_VIEW_DAILY",
        targetType: "LISTING_VIEW_DAILY",
        targetId: twoYearsAgo.toISOString().slice(0, 10),
        reason: "Listing view daily retention cleanup",
        metadata: {
          jobName: "guild-metrics",
          cutoff: twoYearsAgo.toISOString(),
          deletedRows: deletedViewRows,
          complete: deletedViewRowsComplete,
        },
      });
    }
  } catch (err) {
    const code = getErrorCode(err);
    errors.push({ sellerId: "listing-view-cleanup", code });
    Sentry.captureException(err, { tags: { source: "cron_guild_metrics_cleanup", code } });
  }

  return { processed, warned, revokedMaster, deletedViewRows, deletedViewRowsComplete, errors };
}

async function fetchGuildSellerBatch(cursorId: string | null) {
  return prisma.sellerProfile.findMany({
    where: {
      guildLevel: { in: ["GUILD_MEMBER", "GUILD_MASTER"] },
      vacationMode: false,
    },
    orderBy: { id: "asc" },
    take: SELLER_PAGE_SIZE,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    select: {
      id: true,
      userId: true,
      guildLevel: true,
      consecutiveMetricFailures: true,
      metricWarningSentAt: true,
      user: { select: { name: true, email: true } },
    },
  });
}

type GuildSeller = Awaited<ReturnType<typeof fetchGuildSellerBatch>>[number];

async function processGuildSeller(seller: GuildSeller): Promise<{
  processed: number;
  warned: number;
  revokedMaster: number;
}> {
  const metrics = await calculateSellerMetrics(seller.id);
  const now = new Date();

  if (seller.guildLevel !== "GUILD_MASTER") {
    // GUILD_MEMBER — just refresh metrics timestamp, no revocation logic here
    // (member revocation handled in daily guild-member-check cron)
    await prisma.sellerProfile.updateMany({
      where: { id: seller.id, guildLevel: seller.guildLevel },
      data: { lastMetricCheckAt: now },
    });
    return { processed: 1, warned: 0, revokedMaster: 0 };
  }

  const criteria = meetsGuildMasterRequirements(metrics);

  if (criteria.allMet) {
    // All good — reset failure tracking
    await prisma.sellerProfile.updateMany({
      where: { id: seller.id, guildLevel: "GUILD_MASTER" },
      data: {
        consecutiveMetricFailures: 0,
        metricWarningSentAt: null,
        lastMetricCheckAt: now,
      },
    });
    return { processed: 1, warned: 0, revokedMaster: 0 };
  }

  if (seller.consecutiveMetricFailures === 0) {
    // First failure — send warning
    const failedLabels = buildFailedLabels(criteria, metrics);

    const warned = await prisma.sellerProfile.updateMany({
      where: { id: seller.id, guildLevel: "GUILD_MASTER", consecutiveMetricFailures: 0 },
      data: {
        consecutiveMetricFailures: 1,
        metricWarningSentAt: now,
        lastMetricCheckAt: now,
      },
    });
    if (warned.count === 0) return { processed: 1, warned: 0, revokedMaster: 0 };

    await createNotification({
      userId: seller.userId,
      type: "VERIFICATION_REJECTED",
      title: "Guild Master status at risk",
      body: "Your metrics have fallen below Guild Master requirements. You have 30 days to improve before your badge is reviewed. Check your dashboard for details.",
      link: "/dashboard/verification",
    });

    if (seller.user?.email) {
      try {
        await sendGuildMasterWarningEmail({
          seller: { displayName: seller.user.name, email: seller.user.email },
          failedCriteria: failedLabels,
        });
      } catch (err) {
        Sentry.captureException(err, { tags: { source: "cron_guild_metrics_warning_email", sellerId: seller.id } });
      }
    }

    return { processed: 1, warned: 1, revokedMaster: 0 };
  }

  const warningSentAt = seller.metricWarningSentAt;
  if (!warningSentAt || now.getTime() - warningSentAt.getTime() < GUILD_MASTER_WARNING_GRACE_MS) {
    await prisma.sellerProfile.updateMany({
      where: { id: seller.id, guildLevel: "GUILD_MASTER", consecutiveMetricFailures: { gt: 0 } },
      data: {
        metricWarningSentAt: warningSentAt ?? now,
        lastMetricCheckAt: now,
      },
    });
    return { processed: 1, warned: 0, revokedMaster: 0 };
  }

  // Second consecutive failure — revoke Guild Master
  const revocationMetrics = await calculateSellerMetrics(seller.id);
  const revocationCriteria = meetsGuildMasterRequirements(revocationMetrics);
  if (revocationCriteria.allMet) {
    await prisma.sellerProfile.updateMany({
      where: { id: seller.id, guildLevel: "GUILD_MASTER", consecutiveMetricFailures: { gt: 0 } },
      data: {
        consecutiveMetricFailures: 0,
        metricWarningSentAt: null,
        lastMetricCheckAt: now,
      },
    });
    return { processed: 1, warned: 0, revokedMaster: 0 };
  }

  const revocationCutoff = new Date(now.getTime() - GUILD_MASTER_WARNING_GRACE_MS);
  let revoked = false;
  try {
    revoked = await prisma.$transaction(async (tx) => {
      const verificationUpdated = await tx.makerVerification.updateMany({
        where: {
          sellerProfileId: seller.id,
          status: { in: [...GUILD_MASTER_REVOKABLE_VERIFICATION_STATUSES] },
        },
        data: {
          status: "GUILD_MASTER_REJECTED",
          reviewedAt: now,
          reviewNotes: "Metrics fell below requirements for two consecutive months.",
        },
      });
      if (verificationUpdated.count === 0) return false;

      const updated = await tx.sellerProfile.updateMany({
        where: {
          id: seller.id,
          guildLevel: "GUILD_MASTER",
          consecutiveMetricFailures: { gt: 0 },
          metricWarningSentAt: { lte: revocationCutoff },
        },
        data: {
          guildLevel: "GUILD_MEMBER",
          isVerifiedMaker: true,
          consecutiveMetricFailures: 0,
          metricWarningSentAt: null,
          lastMetricCheckAt: now,
          guildMasterApprovedAt: null,
          guildMasterAppliedAt: null,
          guildMasterReviewNotes: null,
        },
      });
      assertGuildVerificationTransition(updated.count, "revoke Guild Master");

      await logSystemActionOrThrow({
        client: tx,
        actorType: "cron",
        actorId: "guild-metrics",
        action: "AUTO_REVOKE_GUILD_MASTER",
        targetType: "SELLER_PROFILE",
        targetId: seller.id,
        reason: "Metrics fell below requirements for two consecutive months.",
        metadata: {
          jobName: "guild-metrics",
          sellerUserId: seller.userId,
          warningSentAt: warningSentAt.toISOString(),
          revocationCutoff: revocationCutoff.toISOString(),
          failedCriteria: buildFailedLabels(revocationCriteria, revocationMetrics),
        },
      });
      return true;
    });
  } catch (error) {
    if (!isGuildVerificationTransitionConflict(error)) throw error;
  }
  if (!revoked) return { processed: 1, warned: 0, revokedMaster: 0 };
  revalidateFeaturedMakerCaches();

  await createNotification({
    userId: seller.userId,
    type: "VERIFICATION_REJECTED",
    title: "Guild Master badge revoked",
    body: "Your metrics fell below requirements for two consecutive months. Your Guild Member badge remains active.",
    link: "/dashboard/verification",
  });

  if (seller.user?.email) {
    try {
      await sendGuildMasterRevokedEmail({
        seller: { displayName: seller.user.name, email: seller.user.email },
      });
    } catch (err) {
      Sentry.captureException(err, { tags: { source: "cron_guild_metrics_revoked_email", sellerId: seller.id } });
    }
  }

  return { processed: 1, warned: 0, revokedMaster: 1 };
}

async function deleteOldListingViewDaily(cutoff: Date): Promise<{ count: number; complete: boolean }> {
  return runBoundedDeletionBatches({
    batchSize: VIEW_CLEANUP_BATCH_SIZE,
    timeBudgetMs: VIEW_CLEANUP_TIME_BUDGET_MS,
    deleteBatch: async () => prisma.$executeRaw<number>`
      DELETE FROM "ListingViewDaily"
      WHERE id IN (
        SELECT id
        FROM "ListingViewDaily"
        WHERE date < ${cutoff}
        ORDER BY date ASC
        LIMIT ${VIEW_CLEANUP_BATCH_SIZE}
      )
    `,
  });
}

function getErrorCode(err: unknown): string {
  if (typeof err === "object" && err && "code" in err) {
    return String((err as { code?: unknown }).code ?? "UNKNOWN").slice(0, 64);
  }
  if (err instanceof Error) {
    return err.name.slice(0, 64) || "Error";
  }
  return "UNKNOWN";
}

function buildFailedLabels(
  criteria: ReturnType<typeof meetsGuildMasterRequirements>,
  metrics: Awaited<ReturnType<typeof calculateSellerMetrics>>
): string[] {
  const labels: string[] = [];
  if (!criteria.ratingMet)
    labels.push(
      `Average rating ${metrics.averageRating.toFixed(1)} (need ${GUILD_MASTER_REQUIREMENTS.averageRating}+)`
    );
  if (!criteria.reviewsMet)
    labels.push(
      `Review count ${metrics.reviewCount} (need ${GUILD_MASTER_REQUIREMENTS.reviewCount}+)`
    );
  if (!criteria.shippingMet)
    labels.push(
      `On-time shipping ${(metrics.onTimeShippingRate * 100).toFixed(0)}% (need ${GUILD_MASTER_REQUIREMENTS.onTimeShippingRate * 100}%+)`
    );
  if (!criteria.responseMet)
    labels.push(
      `Response rate ${(metrics.responseRate * 100).toFixed(0)}% (need ${GUILD_MASTER_REQUIREMENTS.responseRate * 100}%+)`
    );
  if (!criteria.ageMet)
    labels.push(
      `Account age ${metrics.accountAgeDays} days (need ${GUILD_MASTER_REQUIREMENTS.accountAgeDays}+ days)`
    );
  if (!criteria.salesMet)
    labels.push(
      `Completed sales ${formatCurrencyCents(metrics.totalSalesCents)} (need ${formatCurrencyCents(GUILD_MASTER_REQUIREMENTS.totalSalesCents)}+)`
    );
  if (!criteria.casesMet)
    labels.push(`${metrics.activeCaseCount} open dispute${metrics.activeCaseCount !== 1 ? "s" : ""} (need 0)`);
  return labels;
}
