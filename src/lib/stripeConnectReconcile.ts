import { prisma } from "@/lib/db";
import { stripe as defaultStripe } from "@/lib/stripe";
import { mapWithConcurrency } from "@/lib/concurrency";
import { runCronCursorPages } from "@/lib/cronBatchState";
import { isSupportedStripeConnectAccountVersion } from "@/lib/stripeConnectV2";
import { mirrorStripeChargesEnabled } from "@/lib/stripeWebhookMirror";
import { logServerError, sanitizeServerErrorMessage } from "@/lib/serverErrorLogger";

type StripeConnectAccountStatusClient = {
  accounts: {
    retrieve: (accountId: string) => Promise<{ charges_enabled?: boolean | null }>;
  };
};

type StripeConnectReconcileFailure = {
  sellerProfileId: string;
  code: string;
};

type StripeConnectReconcileOutcome =
  | { kind: "refreshed"; changed: boolean; chargesEnabled: boolean }
  | { kind: "skipped_unsupported" }
  | { kind: "failed"; failure: StripeConnectReconcileFailure };

export type StripeConnectReconcileResult = {
  ok: true;
  pagesFetched: number;
  scanned: number;
  refreshed: number;
  changed: number;
  disabled: number;
  skippedUnsupported: number;
  failures: StripeConnectReconcileFailure[];
};

export const STRIPE_CONNECT_RECONCILE_BATCH_SIZE = 200;
const STRIPE_CONNECT_RECONCILE_CONCURRENCY = 3;

function stripeConnectReconcileErrorCode(error: unknown) {
  const value = typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : null;
  if (typeof value === "string" && value.length > 0) return value.slice(0, 80);
  return sanitizeServerErrorMessage(error).slice(0, 80) || "unknown";
}

export async function processStripeConnectAccountReconciliationBatch({
  take = STRIPE_CONNECT_RECONCILE_BATCH_SIZE,
  stripeClient = defaultStripe,
}: {
  take?: number;
  stripeClient?: StripeConnectAccountStatusClient;
} = {}): Promise<StripeConnectReconcileResult> {
  const requestedTake = Number.isFinite(take) ? Math.floor(take) : STRIPE_CONNECT_RECONCILE_BATCH_SIZE;
  const batchSize = Math.max(1, Math.min(requestedTake, STRIPE_CONNECT_RECONCILE_BATCH_SIZE));
  const result: StripeConnectReconcileResult = {
    ok: true,
    pagesFetched: 0,
    scanned: 0,
    refreshed: 0,
    changed: 0,
    disabled: 0,
    skippedUnsupported: 0,
    failures: [],
  };

  const pageResult = await runCronCursorPages({
    pageSize: batchSize,
    fetchPage: (cursorId) =>
      prisma.sellerProfile.findMany({
        where: { stripeAccountId: { not: null } },
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        orderBy: { id: "asc" },
        take: batchSize,
        select: {
          id: true,
          stripeAccountId: true,
          stripeAccountVersion: true,
        },
      }),
    getCursor: (seller) => seller.id,
    processPage: async (sellers) => {
      result.scanned += sellers.length;
      const outcomes = await mapWithConcurrency(
        sellers,
        STRIPE_CONNECT_RECONCILE_CONCURRENCY,
        async (seller): Promise<StripeConnectReconcileOutcome> => {
          if (!seller.stripeAccountId) return { kind: "skipped_unsupported" };
          if (!isSupportedStripeConnectAccountVersion(seller.stripeAccountVersion)) {
            return { kind: "skipped_unsupported" };
          }

          try {
            const account = await stripeClient.accounts.retrieve(seller.stripeAccountId);
            const mirrorResult = await mirrorStripeChargesEnabled({
              accountId: seller.stripeAccountId,
              chargesEnabled: Boolean(account.charges_enabled),
              route: "/api/cron/stripe-connect-reconcile",
            });

            return {
              kind: "refreshed",
              changed: mirrorResult.matched ? mirrorResult.changed : false,
              chargesEnabled: mirrorResult.matched
                ? mirrorResult.chargesEnabled
                : Boolean(account.charges_enabled),
            };
          } catch (error) {
            const failure = {
              sellerProfileId: seller.id,
              code: stripeConnectReconcileErrorCode(error),
            };
            logServerError(error, {
              source: "stripe_connect_reconcile_account",
              extra: {
                sellerProfileId: seller.id,
                stripeAccountVersion: seller.stripeAccountVersion ?? "legacy",
                code: failure.code,
              },
            });
            return { kind: "failed", failure };
          }
        },
      );

      for (const outcome of outcomes) {
        if (outcome.status === "rejected") {
          const failure = {
            sellerProfileId: "unknown",
            code: stripeConnectReconcileErrorCode(outcome.reason),
          };
          result.failures.push(failure);
          continue;
        }

        if (outcome.value.kind === "skipped_unsupported") {
          result.skippedUnsupported += 1;
          continue;
        }
        if (outcome.value.kind === "failed") {
          result.failures.push(outcome.value.failure);
          continue;
        }

        result.refreshed += 1;
        if (outcome.value.changed) result.changed += 1;
        if (!outcome.value.chargesEnabled) result.disabled += 1;
      }
    },
  });
  result.pagesFetched = pageResult.pagesFetched;

  return result;
}
