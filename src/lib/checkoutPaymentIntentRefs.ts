type StripeObject = Record<string, unknown>;

export type CheckoutPaymentIntentRefs = Readonly<{
  paymentIntentId: string | null;
  stripeChargeId: string | null;
  stripeApplicationFeeId: string | null;
  stripeTransferId: string | null;
}>;

type CheckoutPaymentIntentRefDependencies = Readonly<{
  retrievePaymentIntent: (
    paymentIntentId: string,
    params: { expand: string[] },
  ) => Promise<unknown>;
  retrieveCharge: (
    chargeId: string,
    params: { expand: string[] },
  ) => Promise<unknown>;
  wait?: (milliseconds: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
}>;

export const CHECKOUT_TRANSFER_RETRY_DELAYS_MS = Object.freeze([
  0,
  250,
  750,
  1_500,
]);

function objectRecord(value: unknown): StripeObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as StripeObject
    : null;
}

function stripeObjectId(value: unknown): string | null {
  if (typeof value === "string") return value;
  const record = objectRecord(value);
  return typeof record?.id === "string" ? record.id : null;
}

async function refsFromPaymentIntent(
  paymentIntent: unknown,
  retrieveCharge: CheckoutPaymentIntentRefDependencies["retrieveCharge"],
): Promise<CheckoutPaymentIntentRefs> {
  const paymentIntentRecord = objectRecord(paymentIntent);
  const paymentIntentId = stripeObjectId(paymentIntent);
  const latestCharge = paymentIntentRecord?.latest_charge;
  const charge = typeof latestCharge === "string"
    ? objectRecord(await retrieveCharge(latestCharge, { expand: ["transfer"] }))
    : objectRecord(latestCharge);

  return Object.freeze({
    paymentIntentId,
    stripeChargeId: stripeObjectId(charge),
    stripeApplicationFeeId: stripeObjectId(charge?.application_fee),
    stripeTransferId: stripeObjectId(charge?.transfer),
  });
}

function validateRetryDelays(delays: readonly number[]) {
  if (
    delays.length < 1
    || delays.length > 10
    || delays.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 5_000)
  ) {
    throw new TypeError("Checkout transfer retry delays are invalid");
  }
  return delays;
}

/**
 * Stripe can deliver checkout.session.completed before the destination
 * transfer is visible on the expanded Charge. A missing transfer must not be
 * mistaken for a platform-funded checkout. Re-read the exact PaymentIntent
 * through a short, bounded provider-consistency window and return null only
 * after that window is exhausted; the caller then fails closed and lets the
 * signed webhook retry.
 */
export async function resolveCheckoutPaymentIntentRefs(
  session: { payment_intent?: unknown },
  dependencies: CheckoutPaymentIntentRefDependencies,
): Promise<CheckoutPaymentIntentRefs> {
  const paymentIntentId = stripeObjectId(session.payment_intent);
  if (!paymentIntentId) {
    return Object.freeze({
      paymentIntentId: null,
      stripeChargeId: null,
      stripeApplicationFeeId: null,
      stripeTransferId: null,
    });
  }

  const wait = dependencies.wait
    ?? ((milliseconds: number) => new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    }));
  const delays = validateRetryDelays(
    dependencies.retryDelaysMs ?? CHECKOUT_TRANSFER_RETRY_DELAYS_MS,
  );

  let refs = await refsFromPaymentIntent(
    session.payment_intent,
    dependencies.retrieveCharge,
  );
  if (refs.stripeTransferId) return refs;

  for (const delay of delays) {
    if (delay > 0) await wait(delay);
    const paymentIntent = await dependencies.retrievePaymentIntent(
      paymentIntentId,
      { expand: ["latest_charge.transfer"] },
    );
    refs = await refsFromPaymentIntent(
      paymentIntent,
      dependencies.retrieveCharge,
    );
    if (refs.stripeTransferId) return refs;
  }

  return refs;
}
