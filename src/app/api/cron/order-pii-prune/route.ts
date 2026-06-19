import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyCronRequest } from "@/lib/cronAuth";
import { withSentryCronMonitor } from "@/lib/cronMonitor";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";
import { purgeOldFulfilledOrderBuyerPii } from "@/lib/orderPiiRetention";
import { HTTP_STATUS } from "@/lib/httpStatus";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });
  }

  return withSentryCronMonitor("order-pii-prune", { value: "40 12 * * *", maxRuntimeMinutes: 1 }, async () => {
    const cronRun = await beginCronRun("order-pii-prune");
    if (!cronRun.acquired) return NextResponse.json(skippedCronRunResponse(cronRun));

    try {
      const result = await purgeOldFulfilledOrderBuyerPii();
      const response = {
        ok: true,
        purged: result.purged,
        complete: result.complete,
        cutoff: result.cutoff.toISOString(),
      };
      await completeCronRun(cronRun, response);
      return NextResponse.json(response);
    } catch (error) {
      await failCronRun(cronRun, error);
      Sentry.captureException(error, { tags: { source: "cron_order_pii_prune" } });
      return NextResponse.json({ error: "Order PII prune failed" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
    }
  });
}
