// src/app/api/newsletter/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendNewsletterConfirmationEmail } from "@/lib/email";
import { getIP, newsletterRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { normalizeEmailAddress } from "@/lib/emailSuppression";
import {
  releaseNewsletterSignup,
  reserveNewsletterSignup,
} from "@/lib/emailServiceAccess";
import {
  buildNewsletterConfirmationUrl,
  createNewsletterConfirmationToken,
  hashNewsletterConfirmationToken,
  NEWSLETTER_CONFIRMATION_RESEND_COOLDOWN_MS,
  newsletterConfirmationExpiresAt,
} from "@/lib/newsletterConfirmation";
import { sanitizeUserName } from "@/lib/sanitize";
import { hashEmailForTelemetry } from "@/lib/privacyTelemetry";
import { logServerError } from "@/lib/serverErrorLogger";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { z } from "zod";

const NEWSLETTER_BODY_MAX_BYTES = 8 * 1024;
const NEWSLETTER_CONFIRMATION_RESPONSE = { subscribed: true, confirmationRequired: true } as const;

const NewsletterSchema = z.object({
  email: z.string().min(1).max(254),
  name: z.string().max(200).optional().nullable(),
});

async function clearReservedNewsletterConfirmation(email: string, tokenHash: string, emailHash: string | null) {
  await releaseNewsletterSignup(prisma, { email, tokenHash }).catch((error) => {
    logServerError(error, {
      level: "warning",
      source: "newsletter_confirmation_reservation_cleanup",
      extra: { emailHash },
    });
  });
}

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let emailHash: string | null = null;
  try {
    const ip = getIP(req);
    const rl = await safeRateLimit(newsletterRatelimit, ip);
    if (!rl.success) return rateLimitResponse(rl.reset, "Too many newsletter signup attempts.");

    let parsed;
    try {
      parsed = NewsletterSchema.parse(await readBoundedJson(req, NEWSLETTER_BODY_MAX_BYTES));
    } catch (e) {
      if (isRequestBodyTooLargeError(e)) {
        return NextResponse.json({ error: "Request body too large" }, { status: 413 });
      }
      if (isInvalidJsonBodyError(e)) {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
      }
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      throw e;
    }

    const email = normalizeEmailAddress(parsed.email.trim().normalize("NFC").toLowerCase()) ?? "";
    emailHash = hashEmailForTelemetry(email);
    const name = parsed.name ? sanitizeUserName(parsed.name, 200) || null : null;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }

    const token = createNewsletterConfirmationToken();
    const tokenHash = hashNewsletterConfirmationToken(token);
    const confirmationUrl = buildNewsletterConfirmationUrl(token);
    const expiresAt = newsletterConfirmationExpiresAt();
    const reservedSentAt = new Date();
    const resendCutoff = new Date(reservedSentAt.getTime() - NEWSLETTER_CONFIRMATION_RESEND_COOLDOWN_MS);

    const reservation = await reserveNewsletterSignup(prisma, {
      email,
      name,
      tokenHash,
      expiresAt,
      sentAt: reservedSentAt,
      resendCutoff,
    });
    if (reservation !== "reserved") {
      return NextResponse.json(NEWSLETTER_CONFIRMATION_RESPONSE);
    }

    try {
      await sendNewsletterConfirmationEmail({ email, confirmationUrl }, { throwOnFailure: true });
    } catch (error) {
      await clearReservedNewsletterConfirmation(email, tokenHash, emailHash);
      throw error;
    }

    return NextResponse.json(NEWSLETTER_CONFIRMATION_RESPONSE);
  } catch (err) {
    logServerError(err, {
      level: "warning",
      source: "newsletter_subscribe",
      extra: { emailHash },
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
