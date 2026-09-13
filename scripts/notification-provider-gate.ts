// Retained non-runtime scaffold from the completed 2026-07-22 disposable
// Notification provider proof. No application route imports this module.
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  countUnreadOwnerNotifications,
  findRecentOwnerLowStockNotification,
  markOwnerMessageNotificationsRead,
  markOwnerNotificationRead,
  markOwnerNotificationsRead,
  ownerNotificationBellData,
  ownerNotificationExportRows,
  ownerNotificationPageData,
} from "@/lib/notificationOwnerAccess";

const fixturePrefix = "notification-provider-real";

type GateConfig = Readonly<{
  burstConcurrency: number;
  requests: number;
  runSlot: 1 | 2;
  targetConcurrency: number;
  warmupRequests: number;
}>;

type WorkloadResult = Readonly<{
  concurrency: number;
  errorCount: number;
  label: string;
  maxMs: number;
  meanMs: number;
  p95Ms: number;
  requests: number;
}>;

type BellRow = {
  id: string | null;
  type: string | null;
  title: string | null;
  body: string | null;
  link: string | null;
  read: boolean | null;
  createdAt: Date | null;
  unreadCount: bigint | number;
};

function boundedInteger(
  value: string | undefined,
  fallback: number,
  { label, max, min }: { label: string; max: number; min: number },
) {
  if (value === undefined || value === "") return fallback;
  if (!/^[0-9]+$/.test(value)) throw new Error(`${label} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} is outside the reviewed bound`);
  }
  return parsed;
}

function percentile95(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

async function measureWorkload(
  label: string,
  requests: number,
  concurrency: number,
  operation: (requestIndex: number) => Promise<void>,
): Promise<WorkloadResult> {
  const durations: number[] = [];
  let nextRequest = 0;
  let errorCount = 0;
  const workers = Array.from({ length: Math.min(concurrency, requests) }, async () => {
    for (;;) {
      const requestIndex = nextRequest;
      nextRequest += 1;
      if (requestIndex >= requests) return;
      const startedAt = performance.now();
      try {
        await operation(requestIndex);
      } catch {
        errorCount += 1;
      } finally {
        durations.push(performance.now() - startedAt);
      }
    }
  });
  await Promise.all(workers);
  const total = durations.reduce((sum, value) => sum + value, 0);
  return Object.freeze({
    concurrency,
    errorCount,
    label,
    maxMs: rounded(Math.max(...durations, 0)),
    meanMs: rounded(total / Math.max(durations.length, 1)),
    p95Ms: rounded(percentile95(durations)),
    requests,
  });
}

function fixtureForSlot(runSlot: 1 | 2) {
  const suffix = `slot-${runSlot}`;
  return Object.freeze({
    actorUserId: `${fixturePrefix}-actor-${suffix}`,
    conversationId: `${fixturePrefix}-conversation-${suffix}`,
    foreignNotificationId: `${fixturePrefix}-foreign-${suffix}`,
    lowStockId: `${fixturePrefix}-low-stock-${suffix}`,
    lowStockLink: `/listing/${fixturePrefix}-listing-${suffix}`,
    messageId: `${fixturePrefix}-message-${suffix}`,
    orderId: `${fixturePrefix}-order-${suffix}`,
    readId: `${fixturePrefix}-read-${suffix}`,
    sellerProfileId: `${fixturePrefix}-seller-profile-${suffix}`,
    sellerUserId: `${fixturePrefix}-seller-${suffix}`,
  });
}

async function baselineBell(userId: string) {
  const rows = await prisma.$queryRaw<BellRow[]>(Prisma.sql`
    WITH context AS MATERIALIZED (
      SELECT pg_catalog.set_config('app.user_id', ${userId}::text, true) AS user_id
    ), unread AS MATERIALIZED (
      SELECT pg_catalog.count(*) AS count
        FROM context
        JOIN public."Notification" AS notification
          ON notification."userId" = context.user_id
       WHERE notification.read = false
    ), recent AS MATERIALIZED (
      SELECT
        notification.id,
        notification.type,
        notification.title::text,
        notification.body::text,
        notification.link::text,
        notification.read,
        notification."createdAt"
        FROM context
        JOIN public."Notification" AS notification
          ON notification."userId" = context.user_id
       ORDER BY notification."createdAt" DESC, notification.id DESC
       LIMIT 20
    )
    SELECT
      recent.id,
      recent.type,
      recent.title,
      recent.body,
      recent.link,
      recent.read,
      recent."createdAt",
      unread.count AS "unreadCount"
      FROM unread
      LEFT JOIN recent ON true
     ORDER BY recent."createdAt" DESC NULLS LAST, recent.id DESC NULLS LAST
  `);
  if (rows.length === 0) throw new TypeError("provider baseline returned no summary row");
  return rows;
}

async function baselineSocialSource(
  sellerUserId: string,
  sellerProfileId: string,
  actorUserId: string,
) {
  const rows = await prisma.$queryRaw<Array<{ valid: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1
        FROM public."SellerProfile" AS seller
        JOIN public."Follow" AS follow
          ON follow."sellerProfileId" = seller.id
       WHERE seller.id = ${sellerProfileId}::text
         AND seller."userId" = ${sellerUserId}::text
         AND follow."followerId" = ${actorUserId}::text
    ) AS valid
  `);
  if (rows.length !== 1 || rows[0].valid !== true) {
    throw new TypeError("provider social baseline rejected the reviewed source");
  }
}

async function createSocialReplay(
  sellerUserId: string,
  sellerProfileId: string,
  actorUserId: string,
) {
  const rows = await prisma.$queryRaw<Array<{ notificationId: string | null }>>(Prisma.sql`
    SELECT public.grainline_notification_create_social_event(
      ${randomUUID()}::text,
      ${sellerUserId}::text,
      'NEW_FOLLOWER'::public."NotificationType",
      'follow'::text,
      ${sellerProfileId}::text,
      ${actorUserId}::text
    ) AS "notificationId"
  `);
  const notificationId = rows[0]?.notificationId;
  if (typeof notificationId !== "string" || notificationId.length === 0) {
    throw new TypeError("provider social candidate returned no notification id");
  }
  return notificationId;
}

async function assertStatementLocalContextReset() {
  const rows = await prisma.$queryRaw<Array<{ directCount: bigint | number; userId: string | null }>>`
    SELECT
      (SELECT pg_catalog.count(*) FROM public."Notification") AS "directCount",
      pg_catalog.current_setting('app.user_id', true) AS "userId"
  `;
  const count = Number(rows[0]?.directCount ?? -1);
  if (count !== 0 || (rows[0]?.userId !== null && rows[0]?.userId !== "")) {
    throw new TypeError("provider recipient context leaked beyond one statement");
  }
}

function ratioIssue(
  issues: string[],
  candidate: WorkloadResult,
  baseline: WorkloadResult,
  metric: "meanMs" | "p95Ms",
) {
  if (candidate[metric] > baseline[metric] * 2) {
    issues.push(`${candidate.label} ${metric} exceeded the fixed 2x one-statement baseline`);
  }
}

function evaluatePair(
  issues: string[],
  candidate: WorkloadResult,
  baseline: WorkloadResult,
) {
  if (candidate.errorCount > 0 || baseline.errorCount > 0) {
    issues.push(`${candidate.label} or ${baseline.label} had request errors`);
  }
  if (candidate.p95Ms > 250) {
    issues.push(`${candidate.label} p95 exceeded the fixed 250ms ceiling`);
  }
  ratioIssue(issues, candidate, baseline, "meanMs");
  ratioIssue(issues, candidate, baseline, "p95Ms");
}

async function measurePair(
  config: GateConfig,
  label: string,
  concurrency: number,
  baseline: () => Promise<void>,
  candidate: () => Promise<void>,
) {
  const primeRequests = Math.max(config.warmupRequests, concurrency * 2);
  const prime = async (kind: "baseline" | "candidate", operation: () => Promise<void>) => {
    const result = await measureWorkload(
      `${label}_${kind}_prime`,
      primeRequests,
      concurrency,
      async () => operation(),
    );
    if (result.errorCount > 0) {
      throw new TypeError(`${label} ${kind} concurrency prime had request errors`);
    }
  };
  const baselineWork = () => measureWorkload(
    `${label}_baseline`,
    config.requests,
    concurrency,
    async () => baseline(),
  );
  const candidateWork = () => measureWorkload(
    `${label}_candidate`,
    config.requests,
    concurrency,
    async () => candidate(),
  );
  if (config.runSlot === 1) {
    await prime("baseline", baseline);
    const baselineResult = await baselineWork();
    await prime("candidate", candidate);
    const candidateResult = await candidateWork();
    return { baseline: baselineResult, candidate: candidateResult };
  }
  await prime("candidate", candidate);
  const candidateResult = await candidateWork();
  await prime("baseline", baseline);
  const baselineResult = await baselineWork();
  return { candidate: candidateResult, baseline: baselineResult };
}

export function parseNotificationProviderGateConfig(
  runSlot: 1 | 2,
  env: NodeJS.ProcessEnv = process.env,
): GateConfig {
  return Object.freeze({
    burstConcurrency: boundedInteger(
      env.NOTIFICATION_RLS_PROVIDER_BURST_CONCURRENCY,
      16,
      { label: "provider burst concurrency", max: 20, min: 2 },
    ),
    requests: boundedInteger(
      env.NOTIFICATION_RLS_PROVIDER_REQUESTS,
      120,
      { label: "provider requests", max: 500, min: 20 },
    ),
    runSlot,
    targetConcurrency: boundedInteger(
      env.NOTIFICATION_RLS_PROVIDER_TARGET_CONCURRENCY,
      8,
      { label: "provider target concurrency", max: 10, min: 1 },
    ),
    warmupRequests: boundedInteger(
      env.NOTIFICATION_RLS_PROVIDER_WARMUP_REQUESTS,
      12,
      { label: "provider warmup requests", max: 50, min: 5 },
    ),
  });
}

export async function runNotificationProviderGate(config: GateConfig) {
  const fixture = fixtureForSlot(config.runSlot);
  const issues: string[] = [];
  const catalog = await prisma.$queryRaw<Array<{
    currentDatabase: string;
    currentUser: string;
    forceRls: boolean;
    rls: boolean;
  }>>`
    SELECT
      pg_catalog.current_database() AS "currentDatabase",
      CURRENT_USER AS "currentUser",
      class.relrowsecurity AS rls,
      class.relforcerowsecurity AS "forceRls"
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'Notification'
  `;
  if (
    catalog.length !== 1
    || catalog[0].currentUser !== "grainline_app_runtime"
    || catalog[0].rls !== true
    || catalog[0].forceRls !== false
  ) {
    issues.push("provider runtime identity or Notification NO-FORCE RLS state drifted");
  }

  const bell = await ownerNotificationBellData(fixture.sellerUserId);
  const expectedIds = new Set<string>([
    fixture.lowStockId,
    fixture.messageId,
    fixture.orderId,
    fixture.readId,
  ]);
  if (
    bell.notifications.length !== expectedIds.size
    || bell.notifications.some((notification) => !expectedIds.has(notification.id))
    || bell.unreadCount !== 3
  ) {
    issues.push("provider bell RPC returned the wrong recipient data shape");
  }
  const foreignBell = await ownerNotificationBellData(fixture.actorUserId);
  if (
    foreignBell.notifications.length !== 1
    || foreignBell.notifications[0].id !== fixture.foreignNotificationId
    || foreignBell.unreadCount !== 1
  ) {
    issues.push("provider bell RPC failed the foreign-recipient fixture");
  }
  const page = await ownerNotificationPageData(fixture.sellerUserId, {
    pageSize: 2,
    requestedPage: 99,
  });
  if (page.total !== 4 || page.totalPages !== 2 || page.page !== 2 || page.unreadCount !== 3) {
    issues.push("provider page RPC returned inconsistent pagination metadata");
  }
  if (await countUnreadOwnerNotifications(fixture.sellerUserId) !== 3) {
    issues.push("provider unread RPC returned the wrong count");
  }
  const exportRows = await ownerNotificationExportRows(fixture.sellerUserId);
  if (exportRows.length !== 4) {
    issues.push("provider export RPC returned the wrong row count");
  }
  const recentLowStock = await findRecentOwnerLowStockNotification(
    fixture.sellerUserId,
    fixture.lowStockLink,
    new Date(Date.now() - 60 * 60 * 1000),
  );
  if (recentLowStock?.id !== fixture.lowStockId) {
    issues.push("provider recent-low-stock RPC returned the wrong row");
  }
  await assertStatementLocalContextReset();

  for (let index = 0; index < config.warmupRequests; index += 1) {
    await baselineBell(fixture.sellerUserId);
    await ownerNotificationBellData(fixture.sellerUserId);
  }
  const bellTarget = await measurePair(
    config,
    "notification_bell_target",
    config.targetConcurrency,
    async () => { await baselineBell(fixture.sellerUserId); },
    async () => { await ownerNotificationBellData(fixture.sellerUserId); },
  );
  const bellBurst = await measurePair(
    config,
    "notification_bell_burst",
    config.burstConcurrency,
    async () => { await baselineBell(fixture.sellerUserId); },
    async () => { await ownerNotificationBellData(fixture.sellerUserId); },
  );
  evaluatePair(issues, bellTarget.candidate, bellTarget.baseline);
  evaluatePair(issues, bellBurst.candidate, bellBurst.baseline);

  let serviceReplayStable = true;
  const serviceReplayId = await createSocialReplay(
    fixture.sellerUserId,
    fixture.sellerProfileId,
    fixture.actorUserId,
  );
  for (let index = 0; index < config.warmupRequests; index += 1) {
    await baselineSocialSource(
      fixture.sellerUserId,
      fixture.sellerProfileId,
      fixture.actorUserId,
    );
    const replayId = await createSocialReplay(
      fixture.sellerUserId,
      fixture.sellerProfileId,
      fixture.actorUserId,
    );
    if (replayId !== serviceReplayId) {
      serviceReplayStable = false;
      issues.push("provider social replay identity drifted during warmup");
      break;
    }
  }
  const serviceTarget = await measurePair(
    config,
    "notification_social_source_target",
    config.targetConcurrency,
    async () => {
      await baselineSocialSource(
        fixture.sellerUserId,
        fixture.sellerProfileId,
        fixture.actorUserId,
      );
    },
    async () => {
      if (await createSocialReplay(
        fixture.sellerUserId,
        fixture.sellerProfileId,
        fixture.actorUserId,
      ) !== serviceReplayId) {
        serviceReplayStable = false;
        throw new TypeError("provider social replay identity drifted");
      }
    },
  );
  evaluatePair(issues, serviceTarget.candidate, serviceTarget.baseline);

  if ((await markOwnerNotificationRead(
    fixture.sellerUserId,
    fixture.foreignNotificationId,
  )).count !== 0) {
    issues.push("provider mark-one RPC crossed recipient ownership");
  }
  if ((await markOwnerNotificationRead(
    fixture.sellerUserId,
    fixture.orderId,
  )).count !== 1) {
    issues.push("provider mark-one RPC did not update the own row");
  }
  if ((await markOwnerNotificationsRead(
    fixture.sellerUserId,
    [fixture.lowStockId],
  )).count !== 1) {
    issues.push("provider mark-many RPC did not update the bounded own row");
  }
  if ((await markOwnerMessageNotificationsRead(
    fixture.sellerUserId,
    fixture.conversationId,
  )).count !== 1) {
    issues.push("provider conversation RPC did not update the canonical own row");
  }
  await assertStatementLocalContextReset();

  return Object.freeze({
    catalog: Object.freeze({
      databaseName: catalog[0]?.currentDatabase ?? null,
      forceRls: catalog[0]?.forceRls ?? null,
      rls: catalog[0]?.rls ?? null,
      runtimeRole: catalog[0]?.currentUser ?? null,
    }),
    correctness: Object.freeze({
      bellRows: bell.notifications.length,
      exportRows: exportRows.length,
      foreignRows: foreignBell.notifications.length,
      initialUnread: bell.unreadCount,
      page: page.page,
      serviceReplayStable,
      statementLocalContextReset: true,
    }),
    issueCount: issues.length,
    issues,
    metrics: Object.freeze({ bellBurst, bellTarget, serviceTarget }),
    runSlot: config.runSlot,
  });
}
