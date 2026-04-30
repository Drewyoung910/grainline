export type CaseResolutionKind = "REFUND_FULL" | "REFUND_PARTIAL" | "DISMISSED";

function formatCaseRefundAmount(cents: number | null | undefined, currency: string | null | undefined) {
  const normalizedCurrency = (currency || "USD").toUpperCase();
  const amount = (cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
    }).format(amount);
  } catch {
    return `${normalizedCurrency} ${amount.toFixed(2)}`;
  }
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
    const amount = formatCaseRefundAmount(refundAmountCents, currency);
    return {
      notificationTitle: "Partial refund issued",
      body: `A partial refund of ${amount} has been issued to your original payment method.`,
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
