import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { orderOpsHealthSummaryFromRows } from "@/lib/orderOpsHealthState";

type OrderOpsHealthClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function orderOpsHealthSummary(
  client: OrderOpsHealthClient = prisma,
) {
  const rows = await client.$queryRaw<Array<{
    ambiguous_refund_count: unknown;
    stale_refund_claim_count: unknown;
    manual_review_label_clawback_count: unknown;
    overdue_label_clawback_retry_count: unknown;
    aging_review_needed_count: unknown;
    stale_checkout_reservation_count: unknown;
    recent_payout_failure_count: unknown;
    issue_count: unknown;
  }>>`
    SELECT ambiguous_refund_count, stale_refund_claim_count,
           manual_review_label_clawback_count,
           overdue_label_clawback_retry_count, aging_review_needed_count,
           stale_checkout_reservation_count, recent_payout_failure_count,
           issue_count
      FROM public.grainline_order_ops_health_summary()
  `;
  return orderOpsHealthSummaryFromRows(rows);
}
