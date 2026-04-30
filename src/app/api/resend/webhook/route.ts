import { EmailSuppressionReason, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { Resend, type WebhookEventPayload } from "resend";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { normalizeEmailAddress, suppressEmail } from "@/lib/emailSuppression";
import { truncateText } from "@/lib/sanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESEND_WEBHOOK_RETRY_AFTER_MS = 5 * 60 * 1000;
const TRANSIENT_FAILURE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const TRANSIENT_FAILURE_SUPPRESSION_THRESHOLD = 3;

function emailsFromEvent(event: WebhookEventPayload): string[] {
  const to = "to" in event.data ? event.data.to : [];
  if (Array.isArray(to)) return to.filter(Boolean);
  return typeof to === "string" && to ? [to] : [];
}

function suppressionReason(type: string): EmailSuppressionReason | null {
  if (type === "email.bounced") return EmailSuppressionReason.BOUNCE;
  if (type === "email.complained" || type === "email.suppressed") return EmailSuppressionReason.COMPLAINT;
  return null;
}

function isTransientFailure(type: string) {
  return type === "email.failed" || type === "email.delivery_delayed";
}

function isUniqueViolation(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002";
}

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function reserveWebhookEvent(svixId: string, type: string): Promise<"process" | "processed" | "in_progress"> {
  const now = new Date();
  try {
    await prisma.resendWebhookEvent.create({
      data: {
        svixId,
        type,
        processingStartedAt: now,
      },
    });
    return "process";
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }

  const existing = await prisma.resendWebhookEvent.findUnique({
    where: { svixId },
    select: { processedAt: true, processingStartedAt: true },
  });

  if (existing?.processedAt) return "processed";

  const retryBefore = new Date(now.getTime() - RESEND_WEBHOOK_RETRY_AFTER_MS);
  const claimed = await prisma.resendWebhookEvent.updateMany({
    where: {
      svixId,
      processedAt: null,
      OR: [{ lastError: { not: null } }, { processingStartedAt: null }, { processingStartedAt: { lt: retryBefore } }],
    },
    data: {
      type,
      processingStartedAt: now,
      lastError: null,
    },
  });

  return claimed.count === 1 ? "process" : "in_progress";
}

async function markWebhookProcessed(svixId: string) {
  await prisma.resendWebhookEvent.update({
    where: { svixId },
    data: {
      processedAt: new Date(),
      lastError: null,
    },
  });
}

async function markWebhookFailed(svixId: string, err: unknown) {
  await prisma.resendWebhookEvent.update({
    where: { svixId },
    data: {
      lastError: truncateText(errorMessage(err), 2000),
    },
  });
}

async function recordTransientFailure(email: string, eventId: string, event: WebhookEventPayload): Promise<boolean> {
  const normalized = normalizeEmailAddress(email);
  if (!normalized) return false;

  const now = new Date();
  const windowStart = new Date(now.getTime() - TRANSIENT_FAILURE_WINDOW_MS);
  const existing = await prisma.emailFailureCount.findUnique({
    where: { email: normalized },
    select: { firstFailedAt: true },
  });

  const failure =
    !existing || existing.firstFailedAt < windowStart
      ? await prisma.emailFailureCount.upsert({
          where: { email: normalized },
          create: {
            email: normalized,
            count: 1,
            firstFailedAt: now,
            lastFailedAt: now,
            lastEventId: eventId,
          },
          update: {
            count: 1,
            firstFailedAt: now,
            lastFailedAt: now,
            lastEventId: eventId,
          },
        })
      : await prisma.emailFailureCount.update({
          where: { email: normalized },
          data: {
            count: { increment: 1 },
            lastFailedAt: now,
            lastEventId: eventId,
          },
        });

  if (failure.count < TRANSIENT_FAILURE_SUPPRESSION_THRESHOLD) return false;

  await suppressEmail({
    email: normalized,
    reason: EmailSuppressionReason.BOUNCE,
    source: "resend_transient_failure",
    eventId,
    details: event as unknown as Prisma.InputJsonValue,
  });
  return true;
}

export async function POST(request: Request) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!webhookSecret) {
    Sentry.captureMessage("RESEND_WEBHOOK_SECRET is not configured", { level: "error" });
    return NextResponse.json({ ok: false, error: "Webhook not configured" }, { status: 503 });
  }

  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!id || !timestamp || !signature) {
    return NextResponse.json({ ok: false, error: "Missing webhook signature headers" }, { status: 400 });
  }

  let event: WebhookEventPayload;
  const payload = await request.text();
  try {
    const resend = new Resend(process.env.RESEND_API_KEY || "re_webhook_verify_only");
    event = resend.webhooks.verify({
      webhookSecret,
      payload,
      headers: { id, timestamp, signature },
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { source: "resend_webhook_verify" } });
    return NextResponse.json({ ok: false, error: "Invalid webhook signature" }, { status: 400 });
  }

  const reservation = await reserveWebhookEvent(id, event.type);
  if (reservation !== "process") {
    return NextResponse.json({ ok: true, duplicate: true, status: reservation, type: event.type });
  }

  try {
    const reason = suppressionReason(event.type);
    const emails = emailsFromEvent(event);

    if (reason) {
      await Promise.all(
        emails.map((email) =>
          suppressEmail({
            email,
            reason,
            source: "resend",
            eventId: id,
            details: event as unknown as Prisma.InputJsonValue,
          }),
        ),
      );
      await markWebhookProcessed(id);
      return NextResponse.json({ ok: true, type: event.type, suppressed: emails.length });
    }

    if (isTransientFailure(event.type)) {
      const suppressed = await Promise.all(emails.map((email) => recordTransientFailure(email, id, event)));
      await markWebhookProcessed(id);
      return NextResponse.json({
        ok: true,
        type: event.type,
        failuresTracked: emails.length,
        suppressed: suppressed.filter(Boolean).length,
      });
    }

    await markWebhookProcessed(id);
    return NextResponse.json({ ok: true, ignored: true, type: event.type });
  } catch (err) {
    await markWebhookFailed(id, err);
    Sentry.captureException(err, { tags: { source: "resend_webhook_process", type: event.type } });
    return NextResponse.json({ ok: false, error: "Webhook processing failed" }, { status: 500 });
  }
}
