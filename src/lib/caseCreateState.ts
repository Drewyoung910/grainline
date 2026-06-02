export const CASE_WINDOW_DAYS = 30;
const CASE_WINDOW_MS = CASE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

type CaseWindowOrder = {
  fulfillmentStatus?: string | null;
  estimatedDeliveryDate?: Date | string | null;
  deliveredAt?: Date | string | null;
  pickedUpAt?: Date | string | null;
};

export function caseEstimatedDeliveryBlockMessage(estimatedDeliveryDate: Date) {
  const formatted = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(estimatedDeliveryDate);

  return `You can open a case after the estimated delivery date (${formatted}) if the order still has not arrived.`;
}

export function caseWindowReferenceDate(order: CaseWindowOrder): Date | null {
  const status = order.fulfillmentStatus ?? "PENDING";
  const value =
    status === "DELIVERED"
      ? order.deliveredAt ?? order.estimatedDeliveryDate
      : status === "PICKED_UP"
        ? order.pickedUpAt ?? order.estimatedDeliveryDate
        : order.estimatedDeliveryDate;

  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function caseWindowClosesAt(order: CaseWindowOrder): Date | null {
  const referenceDate = caseWindowReferenceDate(order);
  return referenceDate ? new Date(referenceDate.getTime() + CASE_WINDOW_MS) : null;
}

export function isOrderCaseWindowClosed(order: CaseWindowOrder, now = new Date()) {
  const closesAt = caseWindowClosesAt(order);
  return Boolean(closesAt && closesAt < now);
}

export function caseWindowClosedMessage(closesAt: Date | null) {
  if (!closesAt) return "The case window for this order has closed.";
  const formatted = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(closesAt);
  return `The case window for this order closed on ${formatted}.`;
}
