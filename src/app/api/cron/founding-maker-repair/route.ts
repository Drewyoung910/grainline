import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyCronRequest } from "@/lib/cronAuth";
import { withSentryCronMonitor } from "@/lib/cronMonitor";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";
import { repairMissedFoundingMakerGrants } from "@/lib/foundingMaker";
import { HTTP_STATUS } from "@/lib/httpStatus";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });
  }

  return withSentryCronMonitor("founding-maker-repair", { value: "10 17 * * *", maxRuntimeMinutes: 1 }, async () => {
    const cronRun = await beginCronRun("founding-maker-repair");
    if (!cronRun.acquired) return NextResponse.json(skippedCronRunResponse(cronRun));

    try {
      const result = await repairMissedFoundingMakerGrants();
      await completeCronRun(cronRun, result);
      return NextResponse.json(result);
    } catch (error) {
      await failCronRun(cronRun, error);
      Sentry.captureException(error, { tags: { source: "cron_founding_maker_repair" } });
      return NextResponse.json({ error: "Founding Maker repair failed" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
    }
  });
}
