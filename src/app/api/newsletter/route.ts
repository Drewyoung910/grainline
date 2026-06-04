// src/app/api/newsletter/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { sendNewsletterConfirmationEmail } from "@/lib/email";
import { getIP, newsletterRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { isEmailSuppressed, normalizeEmailAddress } from "@/lib/emailSuppression";
import {
  buildNewsletterConfirmationUrl,
  canSendNewsletterConfirmation,
  createNewsletterConfirmationToken,
  hashNewsletterConfirmationToken,
  newsletterConfirmationExpiresAt,
} from "@/lib/newsletterConfirmation";
import { sanitizeUserName } from "@/lib/sanitize";
import { hashEmailForTelemetry } from "@/lib/privacyTelemetry";
import { sanitizeEmailOutboxError } from "@/lib/emailOutboxSanitize";
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

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
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

    if (await isEmailSuppressed(email)) {
      return NextResponse.json(NEWSLETTER_CONFIRMATION_RESPONSE);
    }

    const existing = await prisma.newsletterSubscriber.findUnique({
      where: { email },
      select: { active: true, confirmationSentAt: true },
    });

    if (existing?.active || !canSendNewsletterConfirmation(existing?.confirmationSentAt)) {
      return NextResponse.json(NEWSLETTER_CONFIRMATION_RESPONSE);
    }

    const token = createNewsletterConfirmationToken();
    const tokenHash = hashNewsletterConfirmationToken(token);
    const confirmationUrl = buildNewsletterConfirmationUrl(token);
    const expiresAt = newsletterConfirmationExpiresAt();

    if (existing) {
      const pendingUpdate = await prisma.newsletterSubscriber.updateMany({
        where: { email, active: false },
        data: {
          name: name ?? undefined,
          confirmationTokenHash: tokenHash,
          confirmationExpiresAt: expiresAt,
          confirmationSentAt: null,
          confirmedAt: null,
        },
      });

      if (pendingUpdate.count !== 1) {
        return NextResponse.json(NEWSLETTER_CONFIRMATION_RESPONSE);
      }
    } else {
      try {
        await prisma.newsletterSubscriber.create({
          data: {
            email,
            name,
            active: false,
            confirmationTokenHash: tokenHash,
            confirmationExpiresAt: expiresAt,
            confirmationSentAt: null,
            confirmedAt: null,
          },
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return NextResponse.json(NEWSLETTER_CONFIRMATION_RESPONSE);
        }
        throw error;
      }
    }

    await sendNewsletterConfirmationEmail({ email, confirmationUrl }, { throwOnFailure: true });

    await prisma.newsletterSubscriber.updateMany({
      where: { email, confirmationTokenHash: tokenHash, active: false },
      data: { confirmationSentAt: new Date() },
    });

    return NextResponse.json(NEWSLETTER_CONFIRMATION_RESPONSE);
  } catch (err) {
    console.error("POST /api/newsletter error:", sanitizeEmailOutboxError(err));
    Sentry.captureException(err, {
      level: "warning",
      tags: { source: "newsletter_subscribe" },
      extra: { emailHash },
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
