import { NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cronAuth";
import { withSentryCronMonitor } from "@/lib/cronMonitor";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";
import { logServerError } from "@/lib/serverErrorLogger";
import { HTTP_STATUS } from "@/lib/httpStatus";
import {
  expireCommissionRequestBatch,
  expiredCommissionRequestCount,
} from "@/lib/commissionRequestAccess";

export const runtime = "nodejs";
export const maxDuration = 60;

const COMMISSION_EXPIRE_BATCH_SIZE = 200;
const COMMISSION_EXPIRE_MAX_BATCHES = 5;

export async function GET(req: Request) {
  if (!verifyCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });
  }

  return withSentryCronMonitor("commission-expire", { value: "40 9 * * *", maxRuntimeMinutes: 1 }, async () => {
    const cronRun = await beginCronRun("commission-expire");
    if (!cronRun.acquired) return NextResponse.json(skippedCronRunResponse(cronRun));

    try {
      let expired = 0;
      let checked = 0;
      let batches = 0;
      let lastBatchFull = false;
      const failures: Array<{ requestId: string; code: string }> = [];

    for (let batch = 0; batch < COMMISSION_EXPIRE_MAX_BATCHES; batch += 1) {
      const expiring = await expireCommissionRequestBatch(COMMISSION_EXPIRE_BATCH_SIZE);
      if (expiring.length === 0) {
        lastBatchFull = false;
        break;
      }

      batches += 1;
      checked += expiring.length;
      expired += expiring.length;
      lastBatchFull = expiring.length === COMMISSION_EXPIRE_BATCH_SIZE;

      if (!lastBatchFull) {
        break;
      }
    }

    const remainingOpenExpired = lastBatchFull
      ? await expiredCommissionRequestCount()
      : 0;
    const hasMore = remainingOpenExpired > 0;

    const response = { ok: true, expired, checked, batches, hasMore, failures };
    await completeCronRun(cronRun, response);
    return NextResponse.json(response);
  } catch (error) {
    await failCronRun(cronRun, error);
    logServerError(error, { source: "cron_commission_expire" });
    return NextResponse.json({ error: "Internal server error" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }
  });
}
