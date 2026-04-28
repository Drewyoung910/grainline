import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyCronRequest } from "@/lib/cronAuth";
import { beginCronRun, completeCronRun, failCronRun, skippedCronRunResponse } from "@/lib/cronRun";
import { processEmailOutboxBatch } from "@/lib/emailOutbox";

export const runtime = "nodejs";
export const maxDuration = 60;

function fiveMinuteBucket(date = new Date()) {
  const minute = Math.floor(date.getUTCMinutes() / 5) * 5;
  return `${date.toISOString().slice(0, 14)}${String(minute).padStart(2, "0")}`;
}

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cronRun = await beginCronRun("email-outbox", fiveMinuteBucket());
  if (!cronRun.acquired) return NextResponse.json(skippedCronRunResponse(cronRun));

  try {
    const result = await processEmailOutboxBatch({ take: 50, concurrency: 5 });
    await completeCronRun(cronRun, result);
    return NextResponse.json(result);
  } catch (error) {
    await failCronRun(cronRun, error);
    Sentry.captureException(error, { tags: { source: "cron_email_outbox" } });
    return NextResponse.json({ error: "Email outbox failed" }, { status: 500 });
  }
}
