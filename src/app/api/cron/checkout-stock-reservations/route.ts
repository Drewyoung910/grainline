import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyCronRequest } from "@/lib/cronAuth";
import { withSentryCronMonitor } from "@/lib/cronMonitor";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";
import {
  CHECKOUT_STOCK_RESERVATION_STALE_BATCH_SIZE,
  restoreStaleCheckoutStockReservations,
} from "@/lib/checkoutStockRestore";

export const runtime = "nodejs";
export const maxDuration = 60;

function quarterHourBucket(date = new Date()) {
  const minute = Math.floor(date.getUTCMinutes() / 15) * 15;
  return `${date.toISOString().slice(0, 14)}${String(minute).padStart(2, "0")}`;
}

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return withSentryCronMonitor("checkout-stock-reservations", { value: "*/15 * * * *", maxRuntimeMinutes: 1 }, async () => {
    const cronRun = await beginCronRun("checkout-stock-reservations", quarterHourBucket());
    if (!cronRun.acquired) return NextResponse.json(skippedCronRunResponse(cronRun));

    try {
      const result = await restoreStaleCheckoutStockReservations({
        take: CHECKOUT_STOCK_RESERVATION_STALE_BATCH_SIZE,
      });
      await completeCronRun(cronRun, result);
      return NextResponse.json(result);
    } catch (error) {
      await failCronRun(cronRun, error);
      Sentry.captureException(error, { tags: { source: "cron_checkout_stock_reservations" } });
      return NextResponse.json({ error: "Checkout stock reservation repair failed" }, { status: 500 });
    }
  });
}
