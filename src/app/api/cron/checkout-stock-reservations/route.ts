import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyCronRequest } from "@/lib/cronAuth";
import { withSentryCronMonitor } from "@/lib/cronMonitor";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";
import {
  CHECKOUT_STOCK_RESERVATION_STALE_BATCH_SIZE,
  CHECKOUT_STOCK_RESERVATION_TERMINAL_PRUNE_BATCH_SIZE,
  pruneTerminalCheckoutStockReservations,
  restoreStaleCheckoutStockReservations,
} from "@/lib/checkoutStockRestore";
import { HTTP_STATUS } from "@/lib/httpStatus";

export const runtime = "nodejs";
export const maxDuration = 60;

function quarterHourBucket(date = new Date()) {
  const minute = Math.floor(date.getUTCMinutes() / 15) * 15;
  return `${date.toISOString().slice(0, 14)}${String(minute).padStart(2, "0")}`;
}

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });
  }

  return withSentryCronMonitor("checkout-stock-reservations", { value: "*/15 * * * *", maxRuntimeMinutes: 1 }, async () => {
    const cronRun = await beginCronRun("checkout-stock-reservations", quarterHourBucket());
    if (!cronRun.acquired) return NextResponse.json(skippedCronRunResponse(cronRun));

    try {
      const repair = await restoreStaleCheckoutStockReservations({
        take: CHECKOUT_STOCK_RESERVATION_STALE_BATCH_SIZE,
      });
      const terminalPrune = await pruneTerminalCheckoutStockReservations({
        take: CHECKOUT_STOCK_RESERVATION_TERMINAL_PRUNE_BATCH_SIZE,
      });
      const result = { ...repair, terminalPrune };
      await completeCronRun(cronRun, result);
      return NextResponse.json(result);
    } catch (error) {
      await failCronRun(cronRun, error);
      Sentry.captureException(error, { tags: { source: "cron_checkout_stock_reservations" } });
      return NextResponse.json({ error: "Checkout stock reservation repair failed" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
    }
  });
}
