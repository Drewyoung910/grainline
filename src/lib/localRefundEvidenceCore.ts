import type { Prisma } from "@prisma/client";
import { DEFAULT_CURRENCY } from "./money.ts";
import { sanitizeText, truncateText } from "./sanitize.ts";

export type LocalRefundEvidenceAction =
  | "SELLER_REFUND_RECORDED"
  | "CASE_REFUND_RECORDED"
  | "BLOCKED_CHECKOUT_REFUND_RECORDED";

export type LocalRefundEvidenceInput = {
  action: LocalRefundEvidenceAction;
  actorType: "webhook" | "staff" | "system";
  actorId: string | null;
  orderId: string;
  refundId: string;
  refundIds: string[];
  amountCents: number;
  currency: string | null | undefined;
  status: string | null | undefined;
  reason: string;
  description: string;
  metadata?: Prisma.InputJsonObject;
};

export function localRefundEvidenceEventId(
  action: LocalRefundEvidenceAction,
  refundId: string,
) {
  return `local:${action.toLowerCase()}:${refundId}`;
}

function boundedText(value: string | null | undefined, max: number) {
  return value ? truncateText(sanitizeText(value), max) || null : null;
}

export function buildLocalRefundEvidenceRecords({
  action,
  actorType,
  actorId,
  orderId,
  refundId,
  refundIds,
  amountCents,
  currency,
  status,
  reason,
  description,
  metadata = {},
}: LocalRefundEvidenceInput) {
  const safeReason = boundedText(reason, 255);
  const safeDescription = boundedText(description, 5000);
  const normalizedCurrency = (currency ?? DEFAULT_CURRENCY).toLowerCase();
  const limitedRefundIds = refundIds.slice(0, 5);

  const ledgerMetadata: Prisma.InputJsonObject = {
    ...metadata,
    localAction: action,
    refundIds: limitedRefundIds,
  };

  const auditMetadata: Prisma.InputJsonObject = {
    stripeRefundId: refundId,
    refundIds: limitedRefundIds,
    amountCents,
    currency: normalizedCurrency,
    status: status ?? null,
    ...metadata,
  };

  return {
    ledgerData: {
      orderId,
      stripeEventId: localRefundEvidenceEventId(action, refundId),
      stripeObjectId: refundId,
      stripeObjectType: "refund",
      eventType: "REFUND",
      amountCents,
      currency: normalizedCurrency,
      status: status ?? null,
      reason: safeReason,
      description: safeDescription,
      metadata: ledgerMetadata,
    } satisfies Prisma.OrderPaymentEventCreateManyInput,
    auditData: {
      actorType,
      actorId: actorId ?? null,
      action,
      targetType: "ORDER",
      targetId: orderId,
      reason: safeReason,
      metadata: auditMetadata,
    },
  };
}
