import * as Sentry from "@sentry/nextjs";
import { banClerkUserAndRevokeSessions } from "@/lib/clerkUserLifecycle";
import { expireOpenCheckoutSessionsForSeller } from "@/lib/checkoutSessionExpiry";
import { readBanAuditMetadata } from "@/lib/banAuditMetadata";
import { sanitizeEmailOutboxError } from "@/lib/emailOutboxSanitize";
import { userBanRepairTarget } from "@/lib/userStaffAccess";
import { getOrderStaffReadClient } from "@/lib/orderStaffReadDb";
import {
  adminAuditLogBanRepairCandidates,
  adminAuditLogBanRepairState,
  appendAdminAuditLogBanRepairEvent,
} from "@/lib/adminAuditLogAccess";

const BAN_SYNC_REPAIR_SCAN_LIMIT = 100;

async function createBanSideEffectAuditLog(input: {
  action:
    | "BAN_USER_CLERK_SYNC"
    | "BAN_USER_CLERK_SYNC_FAILED"
    | "BAN_USER_CHECKOUT_SESSIONS_EXPIRED";
  targetId: string;
  originalActionId: string;
  metadata: Record<string, unknown>;
}) {
  try {
    await appendAdminAuditLogBanRepairEvent(getOrderStaffReadClient(), {
      originalActionId: input.originalActionId,
      action: input.action,
      targetId: input.targetId,
      metadata: input.metadata,
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "ban_side_effect_repair_audit" },
      extra: { action: input.action, targetId: input.targetId, originalActionId: input.originalActionId },
    });
  }
}

export async function repairBanUserExternalSideEffects(input: {
  originalActionId: string;
  targetId: string;
}) {
  const staffClient = getOrderStaffReadClient();
  const repairState = await adminAuditLogBanRepairState(staffClient, {
    originalActionId: input.originalActionId,
    targetId: input.targetId,
  });
  const latestSyncAction = repairState.latestSyncAction;

  const target = await userBanRepairTarget(staffClient, {
    originalActionId: input.originalActionId,
    targetId: input.targetId,
  });
  if (!target || target.deletedAt || !target.banned) return { status: "skipped_target_state" as const };

  let checkoutRepaired = false;
  let checkoutFailed = false;
  if (target.sellerProfileId && target.stripeAccountId) {
    const checkoutAlreadyExpired = repairState.checkoutExpired;
    if (!checkoutAlreadyExpired) {
      try {
        const expiryResult = await expireOpenCheckoutSessionsForSeller({
          sellerId: target.sellerProfileId,
          stripeAccountId: target.stripeAccountId,
          source: "ban_user_repair",
        });
        await createBanSideEffectAuditLog({
          action: "BAN_USER_CHECKOUT_SESSIONS_EXPIRED",
          targetId: input.targetId,
          originalActionId: input.originalActionId,
          metadata: {
            retry: true,
            sellerId: target.sellerProfileId,
            stripeAccountId: target.stripeAccountId,
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
            sellerId: target.sellerProfileId,
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
  const candidates = await adminAuditLogBanRepairCandidates(
    getOrderStaffReadClient(),
    { limit: BAN_SYNC_REPAIR_SCAN_LIMIT },
  );

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
