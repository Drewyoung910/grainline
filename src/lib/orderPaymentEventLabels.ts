const ORDER_PAYMENT_EVENT_TYPE_LABELS: Record<string, string> = {
  REFUND: "Refund",
  DISPUTE: "Dispute",
};

export function orderPaymentEventTypeLabel(eventType: string | null | undefined): string {
  const normalized = eventType?.trim().toUpperCase();
  return normalized ? ORDER_PAYMENT_EVENT_TYPE_LABELS[normalized] ?? "Payment event" : "Payment event";
}
