import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  cspReportDirective,
  cspReportDocumentPath,
  cspReportSentryTags,
  sanitizeCspReportForSentry,
  type CspReportLike,
} from "@/lib/cspReport";
import { cspReportRatelimit, getIP, safeRateLimitOpen } from "@/lib/ratelimit";
import { isRequestBodyTooLargeError, readBoundedText } from "@/lib/requestBody";

const CSP_REPORT_BODY_MAX_BYTES = 32 * 1024;

export async function POST(request: NextRequest) {
  const { success } = await safeRateLimitOpen(cspReportRatelimit, getIP(request));
  if (!success) return new NextResponse(null, { status: 204 });

  let rawBody = "";
  try {
    rawBody = await readBoundedText(request, CSP_REPORT_BODY_MAX_BYTES);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return new NextResponse(null, { status: 204 });
    }
    throw error;
  }
  try {
    const body = JSON.parse(rawBody);
    const report = (body["csp-report"] || body) as CspReportLike;
    const directive = cspReportDirective(report);
    const tags = cspReportSentryTags(report);

    Sentry.addBreadcrumb({
      category: "csp-violation",
      message: `CSP violation: ${directive}`,
      data: {
        blockedUri: report["blocked-uri"],
        violatedDirective: report["violated-directive"],
        documentPath: cspReportDocumentPath(report),
        effectiveDirective: report["effective-directive"],
        checkoutSurface: tags.checkout_surface,
      },
      level: "warning",
    });

    if (directive.includes("script") || directive.includes("frame")) {
      Sentry.captureEvent({
        message: `CSP violation: ${directive}`,
        level: "warning",
        fingerprint: ["csp-violation", directive],
        extra: { report: sanitizeCspReportForSentry(report) },
        tags,
      });
    }

    if (process.env.NODE_ENV === "development") {
      console.warn("[CSP Violation]", JSON.stringify(report, null, 2));
    }
  } catch (err) {
    Sentry.captureException(err, {
      tags: { source: "csp_report_parse" },
      extra: {
        contentType: request.headers.get("content-type"),
        bodyLength: rawBody.length,
      },
    });
  }

  return new NextResponse(null, { status: 204 });
}
