import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  legacyStockRestoreClaimFromRows,
  stripeWebhookHealthSummaryFromRows,
  stripeWebhookPruneCountFromRows,
} from "@/lib/stripeWebhookMaintenanceState";

type StripeWebhookMaintenanceClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function pruneStripeWebhookEventServiceBatch(
  limit: number,
  client: StripeWebhookMaintenanceClient = prisma,
) {
  const rows = await client.$queryRaw<Array<{ deleted_count: unknown }>>`
    SELECT public.grainline_stripe_webhook_prune_batch(${limit}) AS deleted_count
  `;
  return stripeWebhookPruneCountFromRows(rows);
}

export async function stripeWebhookHealthSummary(
  client: StripeWebhookMaintenanceClient = prisma,
) {
  const rows = await client.$queryRaw<Array<{
    failed_count: unknown;
    released_count: unknown;
    stale_count: unknown;
    issue_count: unknown;
  }>>`
    SELECT failed_count, released_count, stale_count, issue_count
      FROM public.grainline_stripe_webhook_health_summary()
  `;
  return stripeWebhookHealthSummaryFromRows(rows);
}

export async function claimLegacyStockRestore(
  sessionId: string,
  client: StripeWebhookMaintenanceClient = prisma,
) {
  const rows = await client.$queryRaw<Array<{ claimed: unknown }>>`
    SELECT public.grainline_legacy_stock_restore_claim(${sessionId}) AS claimed
  `;
  return legacyStockRestoreClaimFromRows(rows);
}
