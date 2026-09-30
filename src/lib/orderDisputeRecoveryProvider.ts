import { createHash } from "node:crypto";
import { stripe as defaultStripe } from "@/lib/stripe";
import {
  finalizeOrderDisputeRecovery,
  type OrderDisputeRecoveryClaim,
} from "@/lib/orderDisputeRecoveryAuthority";

const PROVIDER_TIMEOUT_MS = 5_000;

type StripeId = string | { id?: string | null } | null | undefined;
type Transfer = {
  id: string;
  amount: number;
  amount_reversed?: number | null;
  currency: string;
  destination?: StripeId;
  livemode?: boolean;
  metadata?: Record<string, string> | null;
  transfer_group?: string | null;
};
type Reversal = {
  id: string;
  amount: number;
  currency: string;
  transfer: StripeId;
  source_refund?: StripeId;
  metadata?: Record<string, string> | null;
};
type List<T> = { data: T[]; has_more: boolean };
type RequestOptions = {
  timeout: number;
  maxNetworkRetries: number;
  idempotencyKey?: string;
};

export type OrderDisputeRecoveryStripeClient = {
  transfers: {
    retrieve: (id: string, options?: RequestOptions) => Promise<Transfer>;
    listReversals: (
      id: string,
      params: { limit: number },
      options?: RequestOptions,
    ) => Promise<List<Reversal>>;
    createReversal: (
      id: string,
      params: { amount: number; metadata: Record<string, string> },
      options: RequestOptions,
    ) => Promise<Reversal>;
    list: (
      params: { transfer_group: string; limit: number },
      options?: RequestOptions,
    ) => Promise<List<Transfer>>;
    create: (
      params: {
        amount: number;
        currency: string;
        destination: string;
        transfer_group: string;
        metadata: Record<string, string>;
      },
      options: RequestOptions,
    ) => Promise<Transfer>;
  };
};

function id(value: StripeId) {
  return typeof value === "string" ? value : value?.id ?? null;
}

function scope(claim: OrderDisputeRecoveryClaim) {
  return createHash("sha256")
    .update(`${claim.orderId}:${claim.disputeId}:${claim.stripeTransferId}`, "utf8")
    .digest("hex")
    .slice(0, 40);
}

function requestOptions(idempotencyKey?: string): RequestOptions {
  return {
    timeout: PROVIDER_TIMEOUT_MS,
    maxNetworkRetries: 0,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

function metadata(claim: OrderDisputeRecoveryClaim, action: "reversal" | "restoration") {
  return {
    grainline_order_id: claim.orderId,
    grainline_dispute_id: claim.disputeId,
    grainline_dispute_action: action,
  };
}

function matchesMetadata(
  value: Record<string, string> | null | undefined,
  expected: Record<string, string>,
) {
  return value?.grainline_order_id === expected.grainline_order_id
    && value?.grainline_dispute_id === expected.grainline_dispute_id
    && value?.grainline_dispute_action === expected.grainline_dispute_action;
}

function validateTransfer(transfer: Transfer, claim: OrderDisputeRecoveryClaim) {
  const destination = id(transfer.destination);
  if (
    transfer.id !== claim.stripeTransferId
    || !Number.isSafeInteger(transfer.amount)
    || transfer.amount <= 0
    || !Number.isSafeInteger(transfer.amount_reversed ?? 0)
    || (transfer.amount_reversed ?? 0) < 0
    || (transfer.amount_reversed ?? 0) > transfer.amount
    || transfer.currency !== claim.currency
    || destination === null
    || !/^acct_[A-Za-z0-9]+$/.test(destination)
  ) {
    throw new Error("Stripe seller transfer evidence does not match the dispute claim");
  }
  return { destination, remaining: transfer.amount - (transfer.amount_reversed ?? 0) };
}

function validateReversal(
  reversal: Reversal,
  claim: OrderDisputeRecoveryClaim,
  expected: Record<string, string>,
) {
  if (
    !/^trr_[A-Za-z0-9]+$/.test(reversal.id)
    || id(reversal.transfer) !== claim.stripeTransferId
    || reversal.currency !== claim.currency
    || !Number.isSafeInteger(reversal.amount)
    || reversal.amount <= 0
    || reversal.amount > claim.amountCents
    || reversal.source_refund != null
    || !matchesMetadata(reversal.metadata, expected)
  ) {
    throw new Error("Stripe dispute reversal evidence is ambiguous");
  }
  return reversal;
}

async function reverseSellerTransfer(
  claim: OrderDisputeRecoveryClaim,
  client: OrderDisputeRecoveryStripeClient,
) {
  const transfer = await client.transfers.retrieve(
    claim.stripeTransferId,
    requestOptions(),
  );
  const { destination, remaining } = validateTransfer(transfer, claim);
  const expectedMetadata = metadata(claim, "reversal");
  const listed = await client.transfers.listReversals(
    claim.stripeTransferId,
    { limit: 100 },
    requestOptions(),
  );
  if (listed.has_more) {
    throw new Error("Stripe dispute reversal history exceeds the bounded inspection window");
  }
  const existing = listed.data.filter((candidate) =>
    matchesMetadata(candidate.metadata, expectedMetadata));
  if (existing.length > 1) {
    throw new Error("Stripe dispute recovery found multiple matching reversals");
  }
  if (existing[0]) {
    const reversal = validateReversal(existing[0], claim, expectedMetadata);
    return {
      outcome: "SUCCESS" as const,
      providerObjectId: reversal.id,
      amountCents: reversal.amount,
      sellerStripeAccountId: destination,
    };
  }
  const amount = Math.min(claim.amountCents, remaining);
  if (amount <= 0) {
    return {
      outcome: "NOOP" as const,
      providerObjectId: null,
      amountCents: null,
      sellerStripeAccountId: null,
    };
  }
  const reversal = await client.transfers.createReversal(
    claim.stripeTransferId,
    { amount, metadata: expectedMetadata },
    requestOptions(`grainline-dispute:${scope(claim)}:reverse`),
  );
  validateReversal(reversal, claim, expectedMetadata);
  if (reversal.amount !== amount) {
    throw new Error("Stripe dispute reversal amount changed");
  }
  return {
    outcome: "SUCCESS" as const,
    providerObjectId: reversal.id,
    amountCents: reversal.amount,
    sellerStripeAccountId: destination,
  };
}

function validateRestoration(
  transfer: Transfer,
  claim: OrderDisputeRecoveryClaim,
  expectedMetadata: Record<string, string>,
  transferGroup: string,
) {
  if (
    !/^tr_[A-Za-z0-9]+$/.test(transfer.id)
    || transfer.amount !== claim.reversedAmountCents
    || transfer.currency !== claim.currency
    || id(transfer.destination) !== claim.sellerStripeAccountId
    || transfer.transfer_group !== transferGroup
    || !matchesMetadata(transfer.metadata, expectedMetadata)
  ) {
    throw new Error("Stripe dispute restoration evidence is ambiguous");
  }
  return transfer;
}

async function restoreSellerTransfer(
  claim: OrderDisputeRecoveryClaim,
  client: OrderDisputeRecoveryStripeClient,
) {
  if (claim.reversedAmountCents === null || claim.sellerStripeAccountId === null) {
    throw new Error("Stripe dispute restoration claim is incomplete");
  }
  const expectedMetadata = metadata(claim, "restoration");
  const transferGroup = `grainline_dispute_${scope(claim)}`;
  const listed = await client.transfers.list(
    { transfer_group: transferGroup, limit: 100 },
    requestOptions(),
  );
  if (listed.has_more) {
    throw new Error("Stripe dispute restoration history exceeds the bounded inspection window");
  }
  const existing = listed.data.filter((candidate) =>
    matchesMetadata(candidate.metadata, expectedMetadata));
  if (existing.length > 1) {
    throw new Error("Stripe dispute recovery found multiple matching restorations");
  }
  const transfer = existing[0]
    ? validateRestoration(existing[0], claim, expectedMetadata, transferGroup)
    : validateRestoration(
      await client.transfers.create(
        {
          amount: claim.reversedAmountCents,
          currency: claim.currency,
          destination: claim.sellerStripeAccountId,
          transfer_group: transferGroup,
          metadata: expectedMetadata,
        },
        requestOptions(`grainline-dispute:${scope(claim)}:restore`),
      ),
      claim,
      expectedMetadata,
      transferGroup,
    );
  return {
    outcome: "SUCCESS" as const,
    providerObjectId: transfer.id,
    amountCents: transfer.amount,
    sellerStripeAccountId: claim.sellerStripeAccountId,
  };
}

export function disputeRecoveryErrorSummary(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown Stripe dispute recovery error";
  return message.replace(/\s+/g, " ").trim().slice(0, 500);
}

type Finalize = typeof finalizeOrderDisputeRecovery;

export async function settleOrderDisputeRecovery(
  claim: OrderDisputeRecoveryClaim,
  client: OrderDisputeRecoveryStripeClient = defaultStripe,
  finalize: Finalize = finalizeOrderDisputeRecovery,
) {
  let evidence:
    | Awaited<ReturnType<typeof reverseSellerTransfer>>
    | Awaited<ReturnType<typeof restoreSellerTransfer>>;
  try {
    evidence = claim.action === "REVERSE"
      ? await reverseSellerTransfer(claim, client)
      : await restoreSellerTransfer(claim, client);
  } catch (error) {
    const finalized = await finalize({
      recoveryId: claim.recoveryId,
      claimGeneration: claim.claimGeneration,
      outcome: "FAILED",
      errorSummary: disputeRecoveryErrorSummary(error),
    });
    return { finalized, providerFailed: true, providerError: error };
  }

  // Provider success is deliberately outside the catch. If local acknowledgement
  // fails, the same metadata/idempotency scope is rediscovered on the next claim.
  const finalized = await finalize({
    recoveryId: claim.recoveryId,
    claimGeneration: claim.claimGeneration,
    ...evidence,
  });
  return { finalized, providerFailed: false, providerError: null };
}
