import type { OrderRefundProviderInspection } from "./orderRefundProviderReconciliation.ts";

export type OrderRefundReconciliationClock = {
  providerAuthorizedAtSeconds: number;
};

export type OrderRefundReconciliationAction =
  | "RETRY_EXISTING_SCOPE"
  | "CONFIRMED_PROVIDER_EFFECT"
  | "CONFIRMED_NO_PROVIDER_EFFECT";

const RETRY_WINDOW_SECONDS = 23 * 60 * 60;
const RELEASE_WINDOW_SECONDS = 25 * 60 * 60;

export function chooseOrderRefundReconciliationAction(
  claim: OrderRefundReconciliationClock,
  inspection: OrderRefundProviderInspection,
): {
  action: OrderRefundReconciliationAction | null;
  waitUntilSeconds: number | null;
} {
  const ageSeconds =
    inspection.inspectedAtSeconds - claim.providerAuthorizedAtSeconds;
  if (ageSeconds < 0) {
    throw new TypeError("Order refund provider inspection predates claim authority");
  }
  if (inspection.disposition === "USABLE_REFUND") {
    return { action: "CONFIRMED_PROVIDER_EFFECT", waitUntilSeconds: null };
  }
  if (ageSeconds >= RELEASE_WINDOW_SECONDS) {
    return { action: "CONFIRMED_NO_PROVIDER_EFFECT", waitUntilSeconds: null };
  }
  if (
    inspection.disposition === "ABSENT"
    && ageSeconds < RETRY_WINDOW_SECONDS
  ) {
    return { action: "RETRY_EXISTING_SCOPE", waitUntilSeconds: null };
  }
  return {
    action: null,
    waitUntilSeconds: claim.providerAuthorizedAtSeconds + RELEASE_WINDOW_SECONDS,
  };
}

export const ORDER_REFUND_RECONCILIATION_WINDOWS = {
  retrySeconds: RETRY_WINDOW_SECONDS,
  releaseSeconds: RELEASE_WINDOW_SECONDS,
} as const;
