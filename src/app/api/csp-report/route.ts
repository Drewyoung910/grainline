import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { cspReportRatelimit, getIP, safeRateLimitOpen } from "@/lib/ratelimit";

export async function POST(request: NextRequest) {
  const { success } = await safeRateLimitOpen(cspReportRatelimit, getIP(request));
  if (!success) return new NextResponse(null, { status: 204 });

  try {
    const body = await request.json();
    const report = body["csp-report"] || body;

    Sentry.addBreadcrumb({
      category: "csp-violation",
      message: `CSP violation: ${report["violated-directive"]}`,
      data: {
        blockedUri: report["blocked-uri"],
        violatedDirective: report["violated-directive"],
        documentUri: report["document-uri"],
        effectiveDirective: report["effective-directive"],
      },
      level: "warning",
    });

    const directive =
      report["effective-directive"] || report["violated-directive"] || "";
    if (directive.includes("script") || directive.includes("frame")) {
      Sentry.captureEvent({
        message: `CSP violation: ${directive}`,
        level: "warning",
        fingerprint: ["csp-violation", directive],
        extra: report,
        tags: {
          source: "csp_report",
          event_kind: "security_policy",
          csp_violation: directive,
          blocked_uri: report["blocked-uri"],
        },
      });
    }

    if (process.env.NODE_ENV === "development") {
      console.warn("[CSP Violation]", JSON.stringify(report, null, 2));
    }
  } catch {
    // Ignore parse errors — some browsers send differently formatted reports
  }

  return new NextResponse(null, { status: 204 });
}
