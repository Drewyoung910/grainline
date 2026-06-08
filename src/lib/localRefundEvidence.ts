import type { Prisma } from "@prisma/client";
import { logSystemActionOrThrow } from "@/lib/systemAudit";
import { sanitizeText, truncateText } from "@/lib/sanitize";
import { DEFAULT_CURRENCY } from "@/lib/money";

type LocalRefundEvidenceClient = Pick<Prisma.TransactionClient, "orderPaymentEvent" | "systemAuditLog">;

export type LocalRefundEvidenceAction =
  | "SELLER_REFUND_RECORDED"
  | "CASE_REFUND_RECORDED"
  | "BLOCKED_CHECKOUT_REFUND_RECORDED";

export function localRefundEvidenceEventId(action: LocalRefundEvidenceAction, refundId: string) {
  return `local:${action.toLowerCase()}:${refundId}`;
}

function boundedText(value: string | null | undefined, max: number) {
  return value ? truncateText(sanitizeText(value), max) || null : null;
}

export async function recordLocalRefundEvidence(
  client: LocalRefundEvidenceClient,
  {
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
  }: {
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
  },
) {
  const safeReason = boundedText(reason, 255);
  const safeDescription = boundedText(description, 5000);
  const ledgerMetadata: Prisma.InputJsonObject = {
    ...metadata,
    localAction: action,
    refundIds: refundIds.slice(0, 5),
  };
  const normalizedCurrency = (currency ?? DEFAULT_CURRENCY).toLowerCase();

  await client.orderPaymentEvent.upsert({
    where: { stripeEventId: localRefundEvidenceEventId(action, refundId) },
    update: {},
    create: {
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
    },
  });

  await logSystemActionOrThrow({
    client,
    actorType,
    actorId,
    action,
    targetType: "ORDER",
    targetId: orderId,
    reason: safeReason,
    metadata: {
      stripeRefundId: refundId,
      refundIds: refundIds.slice(0, 5),
      amountCents,
      currency: normalizedCurrency,
      status: status ?? null,
      ...metadata,
    },
  });
}
