import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { banClerkUserAndRevokeSessions } from "@/lib/clerkUserLifecycle";
import { expireOpenCheckoutSessionsForSeller } from "@/lib/checkoutSessionExpiry";
import { readBanAuditMetadata } from "@/lib/banAuditMetadata";
import { sanitizeEmailOutboxError } from "@/lib/emailOutboxSanitize";

const BAN_SYNC_REPAIR_LOOKBACK_DAYS = 14;
const BAN_SYNC_REPAIR_SCAN_LIMIT = 100;
const BAN_SYNC_RELATED_LOG_LIMIT = 25;

const BAN_USER_SYNC_ACTIONS = [
  "BAN_USER_CLERK_SYNC",
  "BAN_USER_CLERK_SYNC_FAILED",
] as const;

function originalActionIdFromMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const originalActionId = (metadata as Record<string, unknown>).originalActionId;
  return typeof originalActionId === "string" ? originalActionId : null;
}

async function createBanSideEffectAuditLog(input: {
  adminId: string;
  action:
    | "BAN_USER_CLERK_SYNC"
    | "BAN_USER_CLERK_SYNC_FAILED"
    | "BAN_USER_CHECKOUT_SESSIONS_EXPIRED";
  targetId: string;
  originalActionId: string;
  metadata: Record<string, unknown>;
}) {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminId: input.adminId,
        action: input.action,
        targetType: "USER",
        targetId: input.targetId,
        metadata: {
          originalActionId: input.originalActionId,
          ...input.metadata,
        },
      },
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "ban_side_effect_repair_audit" },
      extra: { action: input.action, targetId: input.targetId, originalActionId: input.originalActionId },
    });
  }
}

async function latestClerkSyncActionForBan(originalActionId: string, targetId: string) {
  const logs = await prisma.adminAuditLog.findMany({
    where: {
      action: { in: [...BAN_USER_SYNC_ACTIONS] },
      targetType: "USER",
      targetId,
    },
    orderBy: { createdAt: "desc" },
    take: BAN_SYNC_RELATED_LOG_LIMIT,
    select: { action: true, metadata: true },
  });
  return logs.find((log) => originalActionIdFromMetadata(log.metadata) === originalActionId)?.action ?? null;
}

async function hasCheckoutExpiryLogForBan(originalActionId: string, targetId: string) {
  const logs = await prisma.adminAuditLog.findMany({
    where: {
      action: "BAN_USER_CHECKOUT_SESSIONS_EXPIRED",
      targetType: "USER",
      targetId,
    },
    orderBy: { createdAt: "desc" },
    take: BAN_SYNC_RELATED_LOG_LIMIT,
    select: { metadata: true },
  });
  return logs.some((log) => originalActionIdFromMetadata(log.metadata) === originalActionId);
}

export async function repairBanUserExternalSideEffects(input: {
  originalActionId: string;
  adminId: string;
  targetId: string;
}) {
  const latestSyncAction = await latestClerkSyncActionForBan(input.originalActionId, input.targetId);

  const target = await prisma.user.findUnique({
    where: { id: input.targetId },
    select: {
      clerkId: true,
      banned: true,
      deletedAt: true,
      sellerProfile: { select: { id: true, stripeAccountId: true } },
    },
  });
  if (!target || target.deletedAt || !target.banned) return { status: "skipped_target_state" as const };

  let checkoutRepaired = false;
  let checkoutFailed = false;
  if (target.sellerProfile?.stripeAccountId) {
    const checkoutAlreadyExpired = await hasCheckoutExpiryLogForBan(input.originalActionId, input.targetId);
    if (!checkoutAlreadyExpired) {
      try {
        const expiryResult = await expireOpenCheckoutSessionsForSeller({
          sellerId: target.sellerProfile.id,
          stripeAccountId: target.sellerProfile.stripeAccountId,
          source: "ban_user_repair",
        });
        await createBanSideEffectAuditLog({
          adminId: input.adminId,
          action: "BAN_USER_CHECKOUT_SESSIONS_EXPIRED",
          targetId: input.targetId,
          originalActionId: input.originalActionId,
          metadata: {
            retry: true,
            sellerId: target.sellerProfile.id,
            stripeAccountId: target.sellerProfile.stripeAccountId,
            ...expiryResult,
          },
        });
        checkoutRepaired = true;
      } catch (error) {
        checkoutFailed = true;
        Sentry.captureException(error, {
          tags: { source: "ban_user_repair_checkout_session_expiry" },
          extra: {
            targetId: input.targetId,
            originalActionId: input.originalActionId,
            sellerId: target.sellerProfile.id,
          },
        });
      }
    }
  }

  if (latestSyncAction === "BAN_USER_CLERK_SYNC") {
    if (checkoutFailed) return { status: "failed" as const };
    if (checkoutRepaired) return { status: "repaired" as const };
    return { status: "skipped_synced" as const };
  }

  try {
    const result = await banClerkUserAndRevokeSessions(target.clerkId);
    await createBanSideEffectAuditLog({
      adminId: input.adminId,
      action: "BAN_USER_CLERK_SYNC",
      targetId: input.targetId,
      originalActionId: input.originalActionId,
      metadata: {
        retry: true,
        clerkUserId: target.clerkId,
        revokedSessionCount: result.revokedSessionCount,
      },
    });
    if (checkoutFailed) return { status: "failed" as const };
    return { status: "repaired" as const };
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "ban_user_repair_clerk_sync" },
      extra: { targetId: input.targetId, originalActionId: input.originalActionId, clerkUserId: target.clerkId },
    });
    await createBanSideEffectAuditLog({
      adminId: input.adminId,
      action: "BAN_USER_CLERK_SYNC_FAILED",
      targetId: input.targetId,
      originalActionId: input.originalActionId,
      metadata: {
        retry: true,
        clerkUserId: target.clerkId,
        error: sanitizeEmailOutboxError(error),
      },
    });
    return { status: "failed" as const };
  }
}

export async function processBanUserExternalSideEffectRepairBatch({ take = 20 } = {}) {
  const cutoff = new Date(Date.now() - BAN_SYNC_REPAIR_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await prisma.adminAuditLog.findMany({
    where: {
      action: "BAN_USER",
      targetType: "USER",
      undone: false,
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: "desc" },
    take: BAN_SYNC_REPAIR_SCAN_LIMIT,
    select: { id: true, adminId: true, targetId: true, metadata: true },
  });

  let checked = 0;
  let repaired = 0;
  let failed = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const metadata = readBanAuditMetadata(candidate.metadata);
    if (metadata.externalSyncVersion !== 1) continue;
    if (checked >= take) break;
    checked += 1;

    const result = await repairBanUserExternalSideEffects({
      originalActionId: candidate.id,
      adminId: candidate.adminId,
      targetId: candidate.targetId,
    });
    if (result.status === "repaired") repaired += 1;
    else if (result.status === "failed") failed += 1;
    else {
      skipped += 1;
    }
  }

  return { checked, repaired, failed, skipped };
}
