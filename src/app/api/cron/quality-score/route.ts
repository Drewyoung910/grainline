// src/app/api/cron/quality-score/route.ts
//
// Daily cron job to recalculate listing quality scores.
// Schedule: 0 6 * * * (6am UTC daily)

import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { recalculateAllQualityScores } from "@/lib/quality-score";
import { verifyCronRequest } from "@/lib/cronAuth";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await recalculateAllQualityScores();
    return NextResponse.json({
      ok: true,
      updated: result.updated,
      zeroed: result.zeroed,
    });
  } catch (error) {
    console.error("[quality-score cron] Error:", error);
    Sentry.captureException(error, { tags: { source: "cron_quality_score" } });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
