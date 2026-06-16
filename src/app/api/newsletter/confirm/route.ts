import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getIP, newsletterRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { assertContentLengthUnder, isRequestBodyTooLargeError, readOptionalBoundedJson } from "@/lib/requestBody";
import { hashNewsletterConfirmationToken, safeEqualNewsletterTokenHash } from "@/lib/newsletterConfirmation";
import { logServerError } from "@/lib/serverErrorLogger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NEWSLETTER_CONFIRM_JSON_BODY_MAX_BYTES = 8 * 1024;
const NEWSLETTER_CONFIRM_FORM_BODY_MAX_BYTES = 8 * 1024;

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
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function htmlResponse(title: string, message: string, status = 200) {
  return htmlDocument(
    title,
    `<p style="font-size:15px;line-height:1.6;color:#55514a;margin:0;">${escapeHtml(message)}</p>`,
    status,
  );
}

function confirmationResponse(token: string) {
  const action = `/api/newsletter/confirm?token=${encodeURIComponent(token)}&response=html`;
  return htmlDocument(
    "Confirm subscription",
    `<p style="font-size:15px;line-height:1.6;color:#55514a;margin:0;">Confirm that you want to receive Grainline newsletter emails.</p><form method="post" action="${action}" style="margin:24px 0 0;"><button type="submit" style="appearance:none;border:0;background:#1c1c1a;color:#ffffff;padding:12px 18px;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer;">Confirm subscription</button></form>`,
  );
}

function wantsHtmlResponse(req: NextRequest): boolean {
  return new URL(req.url).searchParams.get("response") === "html";
}

async function readConfirmationToken(req: NextRequest): Promise<string | null> {
  const url = new URL(req.url);
  let token = url.searchParams.get("token");
  if (token || req.method !== "POST") return token;

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await readOptionalBoundedJson(req, NEWSLETTER_CONFIRM_JSON_BODY_MAX_BYTES, null)) as {
      token?: unknown;
    } | null;
    token = typeof body?.token === "string" ? body.token : null;
  } else {
    assertContentLengthUnder(req, NEWSLETTER_CONFIRM_FORM_BODY_MAX_BYTES);
    const formData = await req.formData().catch(() => null);
    token = typeof formData?.get("token") === "string" ? String(formData.get("token")) : null;
  }

  return token;
}

async function validateConfirmationToken(req: NextRequest, mode: "json" | "html") {
  const rate = await safeRateLimit(newsletterRatelimit, `newsletter-confirm:${getIP(req)}`);
  if (!rate.success) {
    if (mode === "html") {
      return { response: htmlResponse("Too many requests", "Please wait a few minutes before trying this confirmation link again.", 429) };
    }
    return { response: rateLimitResponse(rate.reset, "Too many newsletter confirmation attempts.") };
  }

  const token = await readConfirmationToken(req);
  if (!token) {
    if (mode === "html") {
      return { response: htmlResponse("Invalid confirmation link", "This confirmation link is invalid or has expired.", 400) };
    }
    return { response: NextResponse.json({ ok: false, error: "Invalid confirmation link" }, { status: 400 }) };
  }

  const tokenHash = hashNewsletterConfirmationToken(token);
  return { token, tokenHash };
}

export async function GET(req: NextRequest) {
  const validated = await validateConfirmationToken(req, "html");
  if ("response" in validated) return validated.response;

  const subscriber = await prisma.newsletterSubscriber.findFirst({
    where: {
      confirmationTokenHash: validated.tokenHash,
      active: false,
      confirmationExpiresAt: { gt: new Date() },
    },
    select: { confirmationTokenHash: true },
  });

  if (!subscriber?.confirmationTokenHash || !safeEqualNewsletterTokenHash(subscriber.confirmationTokenHash, validated.tokenHash)) {
    return htmlResponse("Invalid confirmation link", "This confirmation link is invalid or has expired.", 400);
  }

  return confirmationResponse(validated.token);
}

export async function POST(req: NextRequest) {
  const mode = wantsHtmlResponse(req) ? "html" : "json";
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    if (mode === "html") {
      return htmlResponse("Invalid confirmation request", "This confirmation request could not be verified.", 403);
    }
    return NextResponse.json({ ok: false, error: "Invalid confirmation request" }, { status: 403 });
  }

  let validated: Awaited<ReturnType<typeof validateConfirmationToken>>;
  try {
    validated = await validateConfirmationToken(req, mode);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      if (mode === "html") return htmlResponse("Request too large", "This confirmation request is too large.", 413);
      return NextResponse.json({ ok: false, error: "Request body too large" }, { status: 413 });
    }
    throw error;
  }
  if ("response" in validated) return validated.response;

  try {
    const subscriber = await prisma.newsletterSubscriber.findFirst({
      where: {
        confirmationTokenHash: validated.tokenHash,
        active: false,
        confirmationExpiresAt: { gt: new Date() },
      },
      select: { id: true, confirmationTokenHash: true },
    });

    if (!subscriber?.confirmationTokenHash || !safeEqualNewsletterTokenHash(subscriber.confirmationTokenHash, validated.tokenHash)) {
      if (mode === "html") {
        return htmlResponse("Invalid confirmation link", "This confirmation link is invalid or has expired.", 400);
      }
      return NextResponse.json({ ok: false, error: "Invalid confirmation link" }, { status: 400 });
    }

    const now = new Date();
    const updated = await prisma.newsletterSubscriber.updateMany({
      where: {
        id: subscriber.id,
        active: false,
        confirmationTokenHash: validated.tokenHash,
        confirmationExpiresAt: { gt: now },
      },
      data: {
        active: true,
        confirmedAt: now,
        subscribedAt: now,
        confirmationTokenHash: null,
        confirmationExpiresAt: null,
        confirmationSentAt: null,
      },
    });

    if (updated.count !== 1) {
      if (mode === "html") {
        return htmlResponse("Invalid confirmation link", "This confirmation link is invalid or has expired.", 400);
      }
      return NextResponse.json({ ok: false, error: "Invalid confirmation link" }, { status: 400 });
    }

    if (mode === "html") return htmlResponse("Subscription confirmed", "You're on the Grainline newsletter list.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    logServerError(error, {
      level: "warning",
      source: "newsletter_confirm",
      extra: { tokenHashPrefix: "tokenHash" in validated ? validated.tokenHash.slice(0, 8) : undefined },
    });
    if (mode === "html") return htmlResponse("Confirmation failed", "We could not confirm this subscription. Please try again later.", 500);
    return NextResponse.json({ ok: false, error: "Confirmation failed" }, { status: 500 });
  }
}
