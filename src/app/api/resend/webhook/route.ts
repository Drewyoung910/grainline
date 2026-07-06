import { EmailSuppressionReason, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { Resend, type WebhookEventPayload } from "resend";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { normalizeEmailSuppressionAddress, suppressEmail } from "@/lib/emailSuppression";
import { sanitizeEmailOutboxError } from "@/lib/emailOutboxSanitize";
import { hashEmailForTelemetry } from "@/lib/privacyTelemetry";
import { resolveResendWebhookConfig } from "@/lib/resendWebhookConfig";
import { isRequestBodyTooLargeError, readBoundedText } from "@/lib/requestBody";
import { recordWebhookFailureSpike } from "@/lib/webhookFailureSpike";
import { HTTP_STATUS } from "@/lib/httpStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESEND_WEBHOOK_RETRY_AFTER_MS = 5 * 60 * 1000;
const RESEND_WEBHOOK_BODY_MAX_BYTES = 256 * 1024;
const TRANSIENT_FAILURE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const TRANSIENT_FAILURE_SUPPRESSION_THRESHOLD = 5;
const RESEND_WEBHOOK_RETRY_AFTER_SECONDS = Math.ceil(RESEND_WEBHOOK_RETRY_AFTER_MS / 1000);

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
  return type === "email.failed";
}

function isUniqueViolation(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002";
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
      processingStartedAt: null,
      lastError: sanitizeEmailOutboxError(err),
    },
  });
}

async function requireWebhookTasks<T>(
  tasks: Promise<T>[],
  source: string,
  extra: Record<string, unknown>,
): Promise<T[]> {
  const results = await Promise.allSettled(tasks);
  const values: T[] = [];
  const failures: unknown[] = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      values.push(result.value);
      return;
    }
    failures.push(result.reason);
    Sentry.captureException(result.reason, {
      tags: { source },
      extra: { ...extra, recipientIndex: index },
    });
  });

  if (failures.length > 0) {
    throw new Error(`${source} failed for ${failures.length} recipient(s)`);
  }

  return values;
}

function safeResendWebhookDetails(event: WebhookEventPayload, svixId: string, emails: string[]): Prisma.InputJsonValue {
  return {
    svixId,
    type: event.type,
    recipientCount: emails.length,
    recipientHashes: emails.flatMap((email) => {
      const hash = hashEmailForTelemetry(email);
      return hash ? [hash] : [];
    }),
  };
}

async function recordTransientFailure(
  email: string,
  eventId: string,
  details: Prisma.InputJsonValue,
): Promise<boolean> {
  const normalized = normalizeEmailSuppressionAddress(email);
  if (!normalized) return false;

  const now = new Date();
  const windowStart = new Date(now.getTime() - TRANSIENT_FAILURE_WINDOW_MS);
  const failures = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
    INSERT INTO "EmailFailureCount" (
      email,
      count,
      "firstFailedAt",
      "lastFailedAt",
      "lastEventId"
    )
    VALUES (${normalized}, 1, ${now}, ${now}, ${eventId})
    ON CONFLICT (email) DO UPDATE SET
      count = CASE
        WHEN "EmailFailureCount"."firstFailedAt" < ${windowStart} THEN 1
        WHEN "EmailFailureCount"."lastEventId" = ${eventId} THEN "EmailFailureCount".count
        ELSE "EmailFailureCount".count + 1
      END,
      "firstFailedAt" = CASE
        WHEN "EmailFailureCount"."firstFailedAt" < ${windowStart} THEN ${now}
        ELSE "EmailFailureCount"."firstFailedAt"
      END,
      "lastFailedAt" = ${now},
      "lastEventId" = ${eventId}
    RETURNING count
  `);
  const failureCount = Number(failures[0]?.count ?? 0);

  if (failureCount < TRANSIENT_FAILURE_SUPPRESSION_THRESHOLD) return false;

  await suppressEmail({
    email: normalized,
    reason: EmailSuppressionReason.BOUNCE,
    source: "resend_transient_failure",
    eventId,
    details,
  });
  return true;
}

export async function POST(request: Request) {
  const config = resolveResendWebhookConfig();
  if (!config.ok) {
    Sentry.captureMessage("Resend webhook is not configured", {
      level: "error",
      tags: { source: "resend_webhook_config" },
      extra: { missing: config.missing },
    });
    await recordWebhookFailureSpike({ webhook: "resend", kind: "config", status: HTTP_STATUS.SERVICE_UNAVAILABLE });
    return NextResponse.json(
      { ok: false, error: "Webhook not configured" },
      { status: HTTP_STATUS.SERVICE_UNAVAILABLE },
    );
  }

  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!id || !timestamp || !signature) {
    Sentry.captureMessage("Resend webhook signature headers missing", {
      level: "warning",
      tags: { source: "resend_webhook_signature" },
      extra: {
        hasSvixId: Boolean(id),
        hasSvixTimestamp: Boolean(timestamp),
        hasSvixSignature: Boolean(signature),
      },
    });
    await recordWebhookFailureSpike({ webhook: "resend", kind: "signature", status: HTTP_STATUS.BAD_REQUEST });
    return NextResponse.json(
      { ok: false, error: "Missing webhook signature headers" },
      { status: HTTP_STATUS.BAD_REQUEST },
    );
  }

  let event: WebhookEventPayload;
  let payload = "";
  try {
    payload = await readBoundedText(request, RESEND_WEBHOOK_BODY_MAX_BYTES);
  } catch (err) {
    if (isRequestBodyTooLargeError(err)) {
      Sentry.captureMessage("Resend webhook payload is too large", {
        level: "warning",
        tags: { source: "resend_webhook_payload" },
        extra: { maxBytes: err.maxBytes, webhookId: id },
      });
      await recordWebhookFailureSpike({
        webhook: "resend",
        kind: "payload",
        status: HTTP_STATUS.PAYLOAD_TOO_LARGE,
      });
      return NextResponse.json({ ok: false, error: "Payload too large" }, { status: HTTP_STATUS.PAYLOAD_TOO_LARGE });
    }
    throw err;
  }
  try {
    const resend = new Resend(config.apiKey);
    event = resend.webhooks.verify({
      webhookSecret: config.webhookSecret,
      payload,
      headers: { id, timestamp, signature },
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { source: "resend_webhook_verify" } });
    await recordWebhookFailureSpike({ webhook: "resend", kind: "signature", status: HTTP_STATUS.BAD_REQUEST });
    return NextResponse.json(
      { ok: false, error: "Invalid webhook signature" },
      { status: HTTP_STATUS.BAD_REQUEST },
    );
  }

  let reservation: Awaited<ReturnType<typeof reserveWebhookEvent>>;
  try {
    reservation = await reserveWebhookEvent(id, event.type);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { source: "resend_webhook_reservation" },
      extra: { svixId: id, type: event.type },
    });
    await recordWebhookFailureSpike({
      webhook: "resend",
      kind: "reservation",
      status: HTTP_STATUS.SERVICE_UNAVAILABLE,
      extra: { svixId: id, type: event.type },
    });
    return NextResponse.json(
      { ok: false, error: "Webhook temporarily unavailable" },
      { status: HTTP_STATUS.SERVICE_UNAVAILABLE },
    );
  }
  if (reservation === "processed") {
    return NextResponse.json({ ok: true, duplicate: true, status: reservation, type: event.type });
  }
  if (reservation === "in_progress") {
    return NextResponse.json(
      { ok: false, duplicate: true, status: reservation, type: event.type },
      { status: HTTP_STATUS.SERVICE_UNAVAILABLE, headers: { "Retry-After": String(RESEND_WEBHOOK_RETRY_AFTER_SECONDS) } },
    );
  }

  try {
    const reason = suppressionReason(event.type);
    const emails = emailsFromEvent(event);
    const safeDetails = safeResendWebhookDetails(event, id, emails);

    if (reason) {
      await requireWebhookTasks(
        emails.map((email) =>
          suppressEmail({
            email,
            reason,
            source: "resend",
            eventId: id,
            details: safeDetails,
          }),
        ),
        "resend_webhook_suppress_email",
        { svixId: id, type: event.type },
      );
      await markWebhookProcessed(id);
      return NextResponse.json({ ok: true, type: event.type, suppressed: emails.length });
    }

    if (isTransientFailure(event.type)) {
      const suppressed = await requireWebhookTasks(
        emails.map((email) => recordTransientFailure(email, id, safeDetails)),
        "resend_webhook_transient_failure",
        { svixId: id, type: event.type },
      );
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
    await markWebhookFailed(id, err).catch((markError) => {
      Sentry.captureException(markError, {
        tags: { source: "resend_webhook_mark_failed", type: event.type },
        extra: { svixId: id },
      });
    });
    Sentry.captureException(err, { tags: { source: "resend_webhook_process", type: event.type } });
    await recordWebhookFailureSpike({
      webhook: "resend",
      kind: "handler",
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      extra: { svixId: id, type: event.type },
    });
    return NextResponse.json(
      { ok: false, error: "Webhook processing failed" },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR },
    );
  }
}
