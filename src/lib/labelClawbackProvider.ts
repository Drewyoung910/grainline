import { labelClawbackErrorMessage, labelClawbackIdempotencyKey } from "./labelClawbackState.ts";

// Matches the existing refund recovery safety margin. A key is not a permanent ledger.
export const LABEL_CLAWBACK_SAFE_REPLAY_MS = 23 * 60 * 60 * 1000;
export const LABEL_CLAWBACK_PROVIDER_TIMEOUT_MS = 5_000;

export type LabelClawbackIntent = {
  orderId: string; stripeTransferId: string; transactionId: string;
  rateObjectId: string; amountCents: number; currency: string;
  // Immutable label purchase time, never the most recent retry/claim time.
  // Missing predecessor evidence permits no POST; retain manual reconciliation.
  labelPurchasedAt?: string | null;
};
type Reversal = {
  id: string; amount: number; currency: string; created: number;
  transfer: string | { id: string }; metadata: Record<string, string> | null;
  source_refund?: string | { id: string } | null;
};
type RequestOptions = { timeout: number; maxNetworkRetries: number; idempotencyKey?: string };
export type LabelClawbackStripeClient = { transfers: {
  createReversal: (id: string, params: { amount: number; metadata: Record<string, string> },
    options: RequestOptions) => Promise<Reversal>;
} };

function purchasedMillis(value: string | null | undefined) {
  if (typeof value !== "string" || !value) return null;
  // The historical fixed record returns timestamp-without-time-zone stored in UTC.
  // The successor batch returns an explicit zone; never use the machine's local zone.
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)?$/.test(value)) return null;
  const day = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  const millis = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`);
  return Number.isFinite(millis) ? millis : null;
}

export function labelClawbackRequest(intent: LabelClawbackIntent) {
  for (const value of [intent.orderId, intent.stripeTransferId, intent.transactionId, intent.rateObjectId]) {
    if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,255}$/.test(value)) {
      throw new TypeError("Label reversal identity is invalid");
    }
  }
  if (!Number.isSafeInteger(intent.amountCents) || intent.amountCents <= 0
    || !/^[a-z]{3}$/.test(intent.currency)) throw new TypeError("Label reversal money is invalid");
  const idempotencyKey = labelClawbackIdempotencyKey({
    orderId: intent.orderId, shippoTransactionId: intent.transactionId,
    shippoRateObjectId: intent.rateObjectId, amountCents: intent.amountCents,
  });
  if (idempotencyKey.length > 255) throw new TypeError("Label reversal key is too long");
  return { transferId: intent.stripeTransferId, params: {
    amount: intent.amountCents,
    // Preserve the original request byte-for-byte; do not add retry metadata.
    metadata: { orderId: intent.orderId, reason: "label_cost_deduction" },
  }, idempotencyKey };
}

function transferId(reversal: Reversal) {
  return typeof reversal.transfer === "string" ? reversal.transfer : reversal.transfer?.id;
}
function validateMatch(reversal: Reversal, intent: LabelClawbackIntent) {
  const purchased = purchasedMillis(intent.labelPurchasedAt);
  if (!/^trr_[A-Za-z0-9]+$/.test(reversal.id) || transferId(reversal) !== intent.stripeTransferId
    || reversal.amount !== intent.amountCents || reversal.currency !== intent.currency
    || !Number.isSafeInteger(reversal.created) || reversal.created <= 0
    || (purchased !== null && reversal.created * 1000 < purchased - 5 * 60 * 1000)
    || reversal.source_refund != null) throw new Error("Label reversal provider evidence is ambiguous");
}

export async function recoverOrCreateLabelClawback(intent: LabelClawbackIntent, client: LabelClawbackStripeClient,
  { now = Date.now, deadline = now() + 25_000 }: { now?: () => number; deadline?: number } = {}) {
  const request = labelClawbackRequest(intent);
  const options = () => {
    if (!Number.isFinite(deadline) || now() + LABEL_CLAWBACK_PROVIDER_TIMEOUT_MS > deadline) {
      throw new Error("Label reversal provider budget exhausted; reconciliation retained");
    }
    return { timeout: LABEL_CLAWBACK_PROVIDER_TIMEOUT_MS, maxNetworkRetries: 0 };
  };
  const purchased = purchasedMillis(intent.labelPurchasedAt);
  const age = purchased === null ? null : now() - purchased;
  if (age === null || !Number.isFinite(age) || age < 0 || age >= LABEL_CLAWBACK_SAFE_REPLAY_MS) {
    throw new Error("Label reversal replay window is unproven or expired; manual reconciliation required");
  }
  // Within retention, this exact POST also recovers the original Stripe result.
  // Do not infer identity from an Order/amount/metadata search: a replacement
  // label on that same Order can have an indistinguishable historical reversal.
  const reversal = await client.transfers.createReversal(request.transferId, request.params,
    { ...options(), idempotencyKey: request.idempotencyKey });
  validateMatch(reversal, intent);
  if (reversal.metadata?.orderId !== intent.orderId
    || reversal.metadata.reason !== request.params.metadata.reason) {
    throw new Error("Label reversal result metadata is invalid");
  }
  return reversal;
}

type Claim = LabelClawbackIntent & { claimId: string; claimGeneration: number; clawbackGeneration: number };
type Finalize = (input: { orderId: string; claimId: string; claimGeneration: number;
  clawbackGeneration: number; outcome: "SUCCESS" | "FAILED";
  reversalId?: string | null; errorSummary?: string | null }) => Promise<Record<string, unknown>>;

export async function settleLabelClawback(claim: Claim, client: LabelClawbackStripeClient, finalize: Finalize,
  timing: { now?: () => number; deadline?: number } = {}) {
  const identity = { orderId: claim.orderId, claimId: claim.claimId,
    claimGeneration: claim.claimGeneration, clawbackGeneration: claim.clawbackGeneration };
  let reversal: Reversal;
  try {
    reversal = await recoverOrCreateLabelClawback(claim, client, timing);
  } catch (error) {
    const finalized = await finalize({ ...identity, outcome: "FAILED",
      errorSummary: labelClawbackErrorMessage(error) });
    return { finalized, providerFailed: true, providerError: error };
  }
  // Deliberately outside the provider catch: an accepted reversal must never be
  // downgraded to FAILED because its local acknowledgement was lost. A stale
  // claim will replay that same key within its safe window, or defer to staff.
  const finalized = await finalize({ ...identity, outcome: "SUCCESS", reversalId: reversal.id });
  return { finalized, providerFailed: false, providerError: null };
}
