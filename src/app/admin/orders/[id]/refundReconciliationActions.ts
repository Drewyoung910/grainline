"use server";

import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  ADMIN_PIN_COOKIE_NAME,
  verifyAdminPinCookieValue,
} from "@/lib/adminPin";
import { adminActionRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { sanitizeText } from "@/lib/sanitize";
import { logServerError } from "@/lib/serverErrorLogger";
import {
  chooseOrderRefundReconciliationAction,
  markOrderRefundClaimAmbiguous,
  prepareOrderRefundReconciliation,
  reconcileOrderRefundClaim,
} from "@/lib/orderRefundReconciliationAuthority";
import {
  inspectOrderRefundProviderEffect,
  resolveOrderRefundProviderOutcome,
} from "@/lib/orderRefundProviderReconciliation";
import { orderRefundProviderEvidence } from "@/lib/orderRefundRecordAuthority";
import {
  finalizeBlockedCheckoutOrderRefund,
  finalizeSellerOrderRefund,
} from "@/lib/orderRefundFinalization";
import {
  revalidateFeaturedMakerCaches,
  revalidateListingSearchCaches,
} from "@/lib/searchCache";

export type RefundReconciliationActionState = {
  ok: boolean;
  error?: string;
  message?: string;
};

const REASON_MIN_CHARS = 10;
const REASON_MAX_CHARS = 1_000;

async function requirePinnedAdmin() {
  const { userId, sessionId } = await auth();
  if (!userId || !sessionId) throw new Error("Unauthorized");
  const { success } = await safeRateLimit(adminActionRatelimit, userId);
  if (!success) throw new Error("Rate limited");
  const cookieStore = await cookies();
  const pinVerified = await verifyAdminPinCookieValue(
    cookieStore.get(ADMIN_PIN_COOKIE_NAME)?.value,
    userId,
    sessionId,
  );
  if (!pinVerified) throw new Error("Admin PIN required");
  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true },
  });
  if (
    !admin
    || admin.role !== "ADMIN"
    || admin.banned
    || admin.deletedAt
  ) {
    throw new Error("Forbidden");
  }
  return admin;
}

async function finalizePreparedRefund(
  orderId: string,
  claim: NonNullable<Awaited<ReturnType<typeof prepareOrderRefundReconciliation>>>,
) {
  const providerResult = await resolveOrderRefundProviderOutcome(claim);
  const evidence = orderRefundProviderEvidence(providerResult);
  const finalize = () => claim.source === "SELLER"
    ? finalizeSellerOrderRefund({
        actorUserId: claim.sourceId,
        orderId,
        claim,
        evidence,
      })
    : finalizeBlockedCheckoutOrderRefund({ orderId, claim, evidence });

  try {
    return await finalize();
  } catch (firstError) {
    logServerError(firstError, {
      source: "admin_order_refund_reconciliation_finalize_retry",
      extra: { orderId, claimSource: claim.source },
    });
    return finalize();
  }
}

export async function reconcileAmbiguousOrderRefund(
  orderId: string,
  _previousState: unknown,
  formData: FormData,
): Promise<RefundReconciliationActionState> {
  let preparedClaim: Awaited<ReturnType<
    typeof prepareOrderRefundReconciliation
  >> = null;
  try {
    const admin = await requirePinnedAdmin();
    const reason = sanitizeText(String(formData.get("reason") ?? ""));
    if (reason.length < REASON_MIN_CHARS) {
      return {
        ok: false,
        error: `Enter at least ${REASON_MIN_CHARS} characters explaining the reconciliation.`,
      };
    }
    if (reason.length > REASON_MAX_CHARS) {
      return {
        ok: false,
        error: `Reconciliation reasons are limited to ${REASON_MAX_CHARS.toLocaleString("en-US")} characters.`,
      };
    }

    preparedClaim = await prepareOrderRefundReconciliation({
      actorUserId: admin.id,
      orderId,
    });
    if (!preparedClaim) {
      return {
        ok: false,
        error: "This order no longer has an active refund claim to reconcile.",
      };
    }

    const inspection = await inspectOrderRefundProviderEffect(preparedClaim, {
      providerAuthorizedAtSeconds:
        preparedClaim.providerAuthorizedAtSeconds,
    });
    const decision = chooseOrderRefundReconciliationAction(
      preparedClaim,
      inspection,
    );
    if (!decision.action) {
      const waitUntil = decision.waitUntilSeconds
        ? new Date(decision.waitUntilSeconds * 1000).toLocaleString("en-US")
        : "the provider safety window closes";
      return {
        ok: false,
        error:
          `Stripe has no usable refund to record, but the safe release window is still open. Try again after ${waitUntil}.`,
      };
    }

    await reconcileOrderRefundClaim({
      actorUserId: admin.id,
      claim: preparedClaim,
      action: decision.action,
      reason,
      inspection,
    });

    if (decision.action === "CONFIRMED_NO_PROVIDER_EFFECT") {
      revalidatePath(`/admin/orders/${orderId}`);
      revalidatePath("/admin/flagged");
      revalidatePath("/admin/orders");
      return {
        ok: true,
        message:
          "Stripe was inspected and no effective refund was found. The exact claim was released with immutable audit evidence.",
      };
    }

    const finalized = await finalizePreparedRefund(orderId, preparedClaim);
    if (finalized.restoredActiveListingCount > 0) {
      revalidateListingSearchCaches();
      revalidateFeaturedMakerCaches();
    }
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/flagged");
    revalidatePath("/admin/orders");
    return {
      ok: true,
      message: decision.action === "CONFIRMED_PROVIDER_EFFECT"
        ? "The exact existing Stripe refund was verified and recorded without creating another refund."
        : "The still-safe idempotency scope was retried and the resulting refund was recorded.",
    };
  } catch (error) {
    if (preparedClaim) {
      try {
        await markOrderRefundClaimAmbiguous({
          claim: preparedClaim,
          reason: "ADMIN_RECONCILIATION_INTERRUPTED",
        });
      } catch (markError) {
        const completed = await prisma.order.findFirst({
          where: {
            id: orderId,
            refundClaimId: null,
            sellerRefundId: { startsWith: "re_" },
          },
          select: { id: true },
        });
        if (completed) {
          revalidatePath(`/admin/orders/${orderId}`);
          return {
            ok: true,
            message:
              "The refund record committed. Any pending notification or email remains in its durable delivery queue.",
          };
        }
        logServerError(markError, {
          source: "admin_order_refund_reconciliation_ambiguous_record",
          extra: { orderId, claimSource: preparedClaim.source },
        });
      }
    }
    logServerError(error, {
      source: "admin_order_refund_reconciliation",
      extra: { orderId, claimSource: preparedClaim?.source ?? null },
    });
    return {
      ok: false,
      error:
        "Reconciliation stopped safely. The claim remains blocked for staff review; refresh before retrying.",
    };
  }
}
