import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  clerkWebhookHealthSummaryFromRows,
  clerkWebhookPruneCountFromRows,
} from "@/lib/clerkWebhookMaintenanceState";

type ClerkWebhookMaintenanceClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function pruneClerkWebhookEventServiceBatch(
  limit: number,
  client: ClerkWebhookMaintenanceClient = prisma,
) {
  const rows = await client.$queryRaw<Array<{ deleted_count: unknown }>>`
    SELECT public.grainline_clerk_webhook_prune_batch(${limit}) AS deleted_count
  `;
  return clerkWebhookPruneCountFromRows(rows);
}

export async function clerkWebhookHealthSummary(
  client: ClerkWebhookMaintenanceClient = prisma,
) {
  const rows = await client.$queryRaw<Array<{
    failed_count: unknown;
    released_count: unknown;
    stale_count: unknown;
    issue_count: unknown;
  }>>`
    SELECT failed_count, released_count, stale_count, issue_count
      FROM public.grainline_clerk_webhook_health_summary()
  `;
  return clerkWebhookHealthSummaryFromRows(rows);
}
