import { formatCurrencyCents } from "./money.ts";

export type CaseResolutionKind = "REFUND_FULL" | "REFUND_PARTIAL" | "DISMISSED";

function formatCaseRefundAmount(cents: number | null | undefined, currency: string | null | undefined) {
  return formatCurrencyCents(cents ?? 0, currency);
}

function hasPositiveRefundAmount(cents: number | null | undefined) {
  return typeof cents === "number" && Number.isFinite(cents) && cents > 0;
}

export function caseResolutionCopy(
  resolution: CaseResolutionKind | string,
  refundAmountCents?: number | null,
  currency?: string | null,
) {
  if (resolution === "REFUND_FULL") {
    return {
      notificationTitle: "Full refund issued",
      body: "A full refund has been issued to your original payment method.",
      emailSubject: "Full refund issued for your case",
      emailHeading: "Full Refund Issued",
      refunding: true,
    };
  }

  if (resolution === "REFUND_PARTIAL") {
    const amount = hasPositiveRefundAmount(refundAmountCents)
      ? formatCaseRefundAmount(refundAmountCents, currency)
      : null;
    return {
      notificationTitle: "Partial refund issued",
      body: amount
        ? `A partial refund of ${amount} has been issued to your original payment method.`
        : "A partial refund has been issued to your original payment method.",
      emailSubject: "Partial refund issued for your case",
      emailHeading: "Partial Refund Issued",
      refunding: true,
    };
  }

  return {
    notificationTitle: "Case dismissed",
    body: "The case has been reviewed and dismissed.",
    emailSubject: "Your case was dismissed",
    emailHeading: "Case Dismissed",
    refunding: false,
  };
}

export function caseResolutionSellerMessage(
  resolution: CaseResolutionKind | string,
  refundAmountCents?: number | null,
  currency?: string | null,
) {
  if (resolution === "REFUND_FULL") {
    return "Grainline resolved this case with a full refund to the buyer.";
  }

  if (resolution === "REFUND_PARTIAL") {
    const amount = hasPositiveRefundAmount(refundAmountCents)
      ? formatCaseRefundAmount(refundAmountCents, currency)
      : null;
    return amount
      ? `Grainline resolved this case with a partial refund of ${amount} to the buyer.`
      : "Grainline resolved this case with a partial refund to the buyer.";
  }

  return "Grainline reviewed this case and dismissed it.";
}
