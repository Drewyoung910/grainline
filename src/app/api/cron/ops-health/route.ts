import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyCronRequest } from "@/lib/cronAuth";
import { withSentryCronMonitor } from "@/lib/cronMonitor";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";
import { prisma } from "@/lib/db";
import { STRIPE_WEBHOOK_EVENT_STALE_PROCESSING_MS } from "@/lib/stripeWebhookEventState";
import { ACCOUNT_DELETION_SIDE_EFFECT_STATUS } from "@/lib/accountDeletionSideEffects";
import { HTTP_STATUS } from "@/lib/httpStatus";

export const runtime = "nodejs";
export const maxDuration = 60;

const FAILED_CRON_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const STALE_CRON_RUNNING_MS = 30 * 60 * 1000;
const STALE_EMAIL_OUTBOX_MS = 30 * 60 * 1000;
const STALE_SVIX_WEBHOOK_PROCESSING_MS = 5 * 60 * 1000;
const STALE_ACCOUNT_DELETION_SIDE_EFFECT_MS = 60 * 60 * 1000;

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });
  }

  return withSentryCronMonitor("ops-health", { value: "20 * * * *", maxRuntimeMinutes: 1 }, async () => {
    const cronRun = await beginCronRun("ops-health");
    if (!cronRun.acquired) return NextResponse.json(skippedCronRunResponse(cronRun));

    try {
      const now = new Date();
      const failedCronSince = new Date(now.getTime() - FAILED_CRON_LOOKBACK_MS);
      const staleCronRunningBefore = new Date(now.getTime() - STALE_CRON_RUNNING_MS);
      const staleEmailBefore = new Date(now.getTime() - STALE_EMAIL_OUTBOX_MS);
      const staleStripeWebhookBefore = new Date(now.getTime() - STRIPE_WEBHOOK_EVENT_STALE_PROCESSING_MS);
      const staleSvixWebhookBefore = new Date(now.getTime() - STALE_SVIX_WEBHOOK_PROCESSING_MS);
      const staleAccountDeletionSideEffectBefore = new Date(now.getTime() - STALE_ACCOUNT_DELETION_SIDE_EFFECT_MS);

      const [
        failedCronRuns,
        staleRunningCronRuns,
        staleEmailOutboxCount,
        deadEmailOutboxCount,
        overdueSupportRequestCount,
        stripeWebhookFailureCount,
        resendWebhookFailureCount,
        clerkWebhookFailureCount,
        accountDeletionSideEffectFailureCount,
      ] = await Promise.all([
        prisma.cronRun.findMany({
          where: {
            status: "FAILED",
            startedAt: { gte: failedCronSince },
            jobName: { not: "ops-health" },
          },
          orderBy: { startedAt: "desc" },
          take: 25,
          select: { id: true, jobName: true, bucket: true, startedAt: true },
        }),
        prisma.cronRun.findMany({
          where: {
            status: "RUNNING",
            startedAt: { lt: staleCronRunningBefore },
            jobName: { not: "ops-health" },
          },
          orderBy: { startedAt: "asc" },
          take: 25,
          select: { id: true, jobName: true, bucket: true, startedAt: true },
        }),
        prisma.emailOutbox.count({
          where: {
            status: { in: ["PENDING", "PROCESSING"] },
            nextAttemptAt: { lt: staleEmailBefore },
          },
        }),
        prisma.emailOutbox.count({
          where: { status: "DEAD" },
        }),
        prisma.supportRequest.count({
          where: {
            status: { in: ["OPEN", "IN_PROGRESS"] },
            slaDueAt: { lt: now },
          },
        }),
        prisma.stripeWebhookEvent.count({
          where: {
            processedAt: null,
            OR: [
              { lastError: { not: null } },
              { processingStartedAt: null },
              { processingStartedAt: { lt: staleStripeWebhookBefore } },
            ],
          },
        }),
        prisma.resendWebhookEvent.count({
          where: {
            processedAt: null,
            OR: [
              { lastError: { not: null } },
              { processingStartedAt: null },
              { processingStartedAt: { lt: staleSvixWebhookBefore } },
            ],
          },
        }),
        prisma.clerkWebhookEvent.count({
          where: {
            processedAt: null,
            OR: [
              { lastError: { not: null } },
              { processingStartedAt: null },
              { processingStartedAt: { lt: staleSvixWebhookBefore } },
            ],
          },
        }),
        prisma.accountDeletionSideEffect.count({
          where: {
            OR: [
              {
                status: ACCOUNT_DELETION_SIDE_EFFECT_STATUS.FAILED,
                lastError: { not: null },
              },
              {
                status: {
                  in: [
                    ACCOUNT_DELETION_SIDE_EFFECT_STATUS.PENDING,
                    ACCOUNT_DELETION_SIDE_EFFECT_STATUS.PROCESSING,
                  ],
                },
                updatedAt: { lt: staleAccountDeletionSideEffectBefore },
              },
            ],
          },
        }),
      ]);

      const issues = {
        failedCronRunCount: failedCronRuns.length,
        staleRunningCronRunCount: staleRunningCronRuns.length,
        staleEmailOutboxCount,
        deadEmailOutboxCount,
        overdueSupportRequestCount,
        stripeWebhookFailureCount,
        resendWebhookFailureCount,
        clerkWebhookFailureCount,
        accountDeletionSideEffectFailureCount,
      };

      if (
        issues.failedCronRunCount > 0 ||
        issues.staleRunningCronRunCount > 0 ||
        issues.staleEmailOutboxCount > 0 ||
        issues.deadEmailOutboxCount > 0 ||
        issues.overdueSupportRequestCount > 0 ||
        issues.stripeWebhookFailureCount > 0 ||
        issues.resendWebhookFailureCount > 0 ||
        issues.clerkWebhookFailureCount > 0 ||
        issues.accountDeletionSideEffectFailureCount > 0
      ) {
        Sentry.captureMessage("Ops health check found actionable issues", {
          level: "warning",
          tags: { source: "cron_ops_health" },
          extra: {
            ...issues,
            failedCronRuns: failedCronRuns.map((run) => ({
              id: run.id,
              jobName: run.jobName,
              bucket: run.bucket,
              startedAt: run.startedAt.toISOString(),
            })),
            staleRunningCronRuns: staleRunningCronRuns.map((run) => ({
              id: run.id,
              jobName: run.jobName,
              bucket: run.bucket,
              startedAt: run.startedAt.toISOString(),
            })),
          },
        });
      }

      const response = { ok: Object.values(issues).every((count) => count === 0), ...issues };
      await completeCronRun(cronRun, response);
      return NextResponse.json(response, {
        status: response.ok ? HTTP_STATUS.OK : HTTP_STATUS.SERVICE_UNAVAILABLE,
      });
    } catch (error) {
      await failCronRun(cronRun, error);
      Sentry.captureException(error, { tags: { source: "cron_ops_health" } });
      return NextResponse.json({ error: "Ops health check failed" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
    }
  });
}
