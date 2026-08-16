import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  sellerPayoutEventApplyFromRows,
  sellerPayoutExportRowsFromRows,
  sellerPayoutLatestFailureFromRows,
  type SellerPayoutEventApplyResult,
  type SellerPayoutExportRow,
  type SellerPayoutLatestFailure,
} from "@/lib/sellerPayoutEventState";

type SellerPayoutAuthorityClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function applySellerPayoutFailure(input: {
  eventId: string;
  claimGeneration: bigint;
  eventCreatedSeconds: bigint;
  connectedAccountId: string;
  payoutId: string;
  amountCents: number | null;
  currency: string;
  failureCode: string | null;
  failureMessage: string | null;
}, client: SellerPayoutAuthorityClient = prisma): Promise<SellerPayoutEventApplyResult> {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT action, payout_event_id, seller_user_id
      FROM public.grainline_seller_payout_event_apply(
        ${input.eventId},
        ${input.claimGeneration},
        ${input.eventCreatedSeconds},
        ${input.connectedAccountId},
        ${input.payoutId},
        ${input.amountCents},
        ${input.currency},
        ${input.failureCode},
        ${input.failureMessage}
      )
  `;
  return sellerPayoutEventApplyFromRows(rows);
}

export async function latestSellerPayoutFailure(
  actorUserId: string,
  client: SellerPayoutAuthorityClient = prisma,
): Promise<SellerPayoutLatestFailure | null> {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT payout_event_id, event_created_seconds, failure_message,
           amount_cents, currency
      FROM public.grainline_seller_payout_latest_failure(${actorUserId})
  `;
  return sellerPayoutLatestFailureFromRows(rows);
}

export async function exportSellerPayoutEvents(
  actorUserId: string,
  client: SellerPayoutAuthorityClient = prisma,
): Promise<SellerPayoutExportRow[]> {
  const pageLimit = 500;
  const result: SellerPayoutExportRow[] = [];
  let beforeEventCreatedSeconds: bigint | null = null;
  let beforeId: string | null = null;

  for (;;) {
    const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
      SELECT payout_event_id, seller_profile_id, stripe_payout_id, status,
             amount_cents, currency, failure_code, failure_message,
             stripe_event_id, event_created_seconds, created_at, updated_at
        FROM public.grainline_seller_payout_export_page(
          ${actorUserId},
          ${pageLimit},
          ${beforeEventCreatedSeconds},
          ${beforeId}
        )
    `;
    const page = sellerPayoutExportRowsFromRows(rows);
    result.push(...page);
    if (page.length < pageLimit) return result;

    const last = page.at(-1);
    if (!last) return result;
    const nextSeconds = BigInt(last.eventCreatedSeconds);
    if (nextSeconds === beforeEventCreatedSeconds && last.id === beforeId) {
      throw new Error("Seller payout export cursor did not advance");
    }
    beforeEventCreatedSeconds = nextSeconds;
    beforeId = last.id;
  }
}
