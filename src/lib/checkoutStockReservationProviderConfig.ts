// CHECKOUT_STOCK_RESERVATION_PROVIDER_RUNNER_ONLY
export const CHECKOUT_RESERVATION_PROVIDER_FIXTURE_PREFIX =
  "checkout-reservation-provider";
export const CHECKOUT_RESERVATION_PROVIDER_FIXTURE_COUNT = 20;

export type CheckoutReservationProviderGateConfig = Readonly<{
  burstConcurrency: number;
  measuredRequests: number;
  runSlot: 1 | 2;
  targetConcurrency: number;
  warmupRequests: number;
}>;

function boundedInteger(
  value: string | undefined,
  fallback: number,
  options: Readonly<{ label: string; max: number; min: number }>,
) {
  if (value === undefined || value === "") return fallback;
  if (!/^[0-9]+$/.test(value)) throw new Error(`${options.label} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < options.min || parsed > options.max) {
    throw new Error(`${options.label} is outside the reviewed bound`);
  }
  return parsed;
}

export function parseCheckoutStockReservationProviderGateConfig(
  runSlot: 1 | 2,
  env: NodeJS.ProcessEnv = process.env,
): CheckoutReservationProviderGateConfig {
  const targetConcurrency = boundedInteger(
    env.CHECKOUT_RESERVATION_PROVIDER_TARGET_CONCURRENCY,
    8,
    { label: "CHECKOUT_RESERVATION_PROVIDER_TARGET_CONCURRENCY", min: 2, max: 10 },
  );
  const burstConcurrency = boundedInteger(
    env.CHECKOUT_RESERVATION_PROVIDER_BURST_CONCURRENCY,
    10,
    { label: "CHECKOUT_RESERVATION_PROVIDER_BURST_CONCURRENCY", min: targetConcurrency, max: 10 },
  );
  return Object.freeze({
    burstConcurrency,
    measuredRequests: boundedInteger(
      env.CHECKOUT_RESERVATION_PROVIDER_REQUESTS,
      80,
      { label: "CHECKOUT_RESERVATION_PROVIDER_REQUESTS", min: 40, max: 160 },
    ),
    runSlot,
    targetConcurrency,
    warmupRequests: boundedInteger(
      env.CHECKOUT_RESERVATION_PROVIDER_WARMUP_REQUESTS,
      10,
      { label: "CHECKOUT_RESERVATION_PROVIDER_WARMUP_REQUESTS", min: 4, max: 30 },
    ),
  });
}

export function checkoutReservationProviderFixture(runSlot: 1 | 2, index: number) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= CHECKOUT_RESERVATION_PROVIDER_FIXTURE_COUNT) {
    throw new Error("checkout reservation provider fixture index is invalid");
  }
  return Object.freeze({
    buyerId: `${CHECKOUT_RESERVATION_PROVIDER_FIXTURE_PREFIX}-buyer-${runSlot}-${index}`,
    listingId: `${CHECKOUT_RESERVATION_PROVIDER_FIXTURE_PREFIX}-listing-${runSlot}-${index}`,
    sellerProfileId: `${CHECKOUT_RESERVATION_PROVIDER_FIXTURE_PREFIX}-seller-${runSlot}`,
    sellerUserId: `${CHECKOUT_RESERVATION_PROVIDER_FIXTURE_PREFIX}-seller-user-${runSlot}`,
  });
}
