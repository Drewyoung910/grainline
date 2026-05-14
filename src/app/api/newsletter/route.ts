// src/app/api/newsletter/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { getIP, newsletterRatelimit, rateLimitResponse, safeRateLimitOpen } from "@/lib/ratelimit";
import { isEmailSuppressed } from "@/lib/emailSuppression";
import { sanitizeUserName } from "@/lib/sanitize";
import { hashEmailForTelemetry } from "@/lib/privacyTelemetry";
import { z } from "zod";

const NewsletterSchema = z.object({
  email: z.string().min(1).max(254),
  name: z.string().max(200).optional().nullable(),
});

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let emailHash: string | null = null;
  try {
    const ip = getIP(req);
    const rl = await safeRateLimitOpen(newsletterRatelimit, ip);
    if (!rl.success) return rateLimitResponse(rl.reset, "Too many newsletter signup attempts.");

    let parsed;
    try {
      parsed = NewsletterSchema.parse(await req.json());
    } catch (e) {
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const email = parsed.email.trim().toLowerCase();
    emailHash = hashEmailForTelemetry(email);
    const name = parsed.name ? sanitizeUserName(parsed.name, 200) || null : null;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }

    if (await isEmailSuppressed(email)) {
      return NextResponse.json({
        subscribed: false,
        suppressed: true,
        message: "This email has been unsubscribed. Contact support@thegrainline.com to re-enable email.",
      });
    }

    await prisma.newsletterSubscriber.upsert({
      where: { email },
      create: { email, name, active: true },
      update: { name: name ?? undefined, active: true },
    });

    return NextResponse.json({ subscribed: true });
  } catch (err) {
    console.error("POST /api/newsletter error:", err);
    Sentry.captureException(err, {
      level: "warning",
      tags: { source: "newsletter_subscribe" },
      extra: { emailHash },
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
