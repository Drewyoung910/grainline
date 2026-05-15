import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { unsubscribeEmail, verifyUnsubscribeToken } from "@/lib/unsubscribe";
import { getIP, rateLimitResponse, safeRateLimit, unsubscribeRatelimit } from "@/lib/ratelimit";
import { logSecurityEvent } from "@/lib/security";
import { hashEmailForTelemetry } from "@/lib/privacyTelemetry";
import { isRequestBodyTooLargeError, readOptionalBoundedJson } from "@/lib/requestBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UNSUBSCRIBE_JSON_BODY_MAX_BYTES = 8 * 1024;

type UnsubscribeParams = { email: string | null; token: string | null; issuedAt: string | null };

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function htmlDocument(title: string, bodyHtml: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#fafaf8;color:#1c1c1a;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;"><main style="max-width:520px;margin:12vh auto;padding:0 24px;"><h1 style="font-size:24px;line-height:1.2;margin:0 0 12px;">${escapeHtml(title)}</h1>${bodyHtml}<p style="margin:24px 0 0;"><a href="/" style="color:#1c1c1a;">Return to Grainline</a></p></main></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

function htmlResponse(title: string, message: string, status = 200) {
  return htmlDocument(
    title,
    `<p style="font-size:15px;line-height:1.6;color:#55514a;margin:0;">${escapeHtml(message)}</p>`,
    status,
  );
}

function confirmationResponse(email: string, token: string, issuedAt: string) {
  const action = `/api/email/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}&issuedAt=${encodeURIComponent(issuedAt)}&response=html`;
  return htmlDocument(
    "Confirm unsubscribe",
    `<p style="font-size:15px;line-height:1.6;color:#55514a;margin:0;">Confirm that you want to turn off Grainline email notifications for ${escapeHtml(email)}.</p><form method="post" action="${action}" style="margin:24px 0 0;"><button type="submit" style="appearance:none;border:0;background:#1c1c1a;color:#ffffff;padding:12px 18px;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer;">Unsubscribe</button></form>`,
  );
}

function wantsHtmlResponse(req: NextRequest): boolean {
  const url = new URL(req.url);
  return url.searchParams.get("response") === "html";
}

async function readUnsubscribeParams(req: NextRequest): Promise<UnsubscribeParams> {
  const url = new URL(req.url);
  let email = url.searchParams.get("email");
  let token = url.searchParams.get("token");
  let issuedAt = url.searchParams.get("issuedAt");

  if ((!email || !token || !issuedAt) && req.method === "POST") {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await readOptionalBoundedJson(req, UNSUBSCRIBE_JSON_BODY_MAX_BYTES, null)) as {
        email?: unknown;
        token?: unknown;
        issuedAt?: unknown;
      } | null;
      email = email ?? (typeof body?.email === "string" ? body.email : null);
      token = token ?? (typeof body?.token === "string" ? body.token : null);
      issuedAt =
        issuedAt ??
        (typeof body?.issuedAt === "string" || typeof body?.issuedAt === "number" ? String(body.issuedAt) : null);
    } else {
      const formData = await req.formData().catch(() => null);
      email = email ?? (typeof formData?.get("email") === "string" ? String(formData.get("email")) : null);
      token = token ?? (typeof formData?.get("token") === "string" ? String(formData.get("token")) : null);
      issuedAt = issuedAt ?? (typeof formData?.get("issuedAt") === "string" ? String(formData.get("issuedAt")) : null);
    }
  }

  return { email, token, issuedAt };
}

async function validateUnsubscribeRequest(req: NextRequest, mode: "json" | "html") {
  const rate = await safeRateLimit(unsubscribeRatelimit, getIP(req));
  if (!rate.success) {
    if (mode === "html") {
      return { response: htmlResponse("Too many requests", "Please wait a few minutes before trying this unsubscribe link again.", 429) };
    }
    return { response: rateLimitResponse(rate.reset, "Too many unsubscribe attempts.") };
  }

  const { email, token, issuedAt } = await readUnsubscribeParams(req);
  if (!email || !token || !issuedAt || !verifyUnsubscribeToken(email, token, issuedAt)) {
    logSecurityEvent("token_rejected", {
      ip: getIP(req),
      route: "/api/email/unsubscribe",
      reason: "invalid unsubscribe token",
      method: req.method,
      hasEmail: !!email,
      hasToken: !!token,
      hasIssuedAt: !!issuedAt,
      tokenLength: token?.length ?? 0,
    });
    if (mode === "html") {
      return { response: htmlResponse("Invalid unsubscribe link", "This unsubscribe link is invalid or has expired.", 400) };
    }
    return { response: NextResponse.json({ ok: false, error: "Invalid unsubscribe link" }, { status: 400 }) };
  }

  return { email, token, issuedAt };
}

async function handlePost(req: NextRequest) {
  const mode = wantsHtmlResponse(req) ? "html" : "json";
  let validated: Awaited<ReturnType<typeof validateUnsubscribeRequest>>;
  try {
    validated = await validateUnsubscribeRequest(req, mode);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      if (mode === "html") {
        return htmlResponse("Request too large", "This unsubscribe request is too large.", 413);
      }
      return NextResponse.json({ ok: false, error: "Request body too large" }, { status: 413 });
    }
    throw error;
  }
  if ("response" in validated) return validated.response;

  const { email } = validated;

  try {
    const result = await unsubscribeEmail(email);
    if (!result.ok) {
      if (mode === "html") return htmlResponse("Invalid email address", "We could not process that email address.", 400);
      return NextResponse.json({ ok: false, error: "Invalid email address" }, { status: 400 });
    }
  } catch (error) {
    console.error("Unsubscribe failed:", error);
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "unsubscribe_email" },
      extra: { emailHash: hashEmailForTelemetry(email) },
    });
    if (mode === "html") return htmlResponse("Unsubscribe failed", "We could not process this request. Please try again later.", 500);
    return NextResponse.json({ ok: false, error: "Unsubscribe failed" }, { status: 500 });
  }

  if (mode === "html") {
    return htmlResponse("You're unsubscribed", "We have turned off Grainline email notifications and removed this email from newsletter sends.");
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  return handlePost(req);
}

export async function GET(req: NextRequest) {
  const validated = await validateUnsubscribeRequest(req, "html");
  if ("response" in validated) return validated.response;
  return confirmationResponse(validated.email, validated.token, validated.issuedAt);
}
