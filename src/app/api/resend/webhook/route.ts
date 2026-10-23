import { EmailSuppressionReason } from "@prisma/client";
import { NextResponse } from "next/server";
import { Resend, type WebhookEventPayload } from "resend";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { suppressEmail } from "@/lib/emailSuppression";
import { sanitizeEmailOutboxError } from "@/lib/emailOutboxSanitize";
import { hashEmailForTelemetry } from "@/lib/privacyTelemetry";
import { resolveResendWebhookConfig } from "@/lib/resendWebhookConfig";
import { isRequestBodyTooLargeError, readBoundedText } from "@/lib/requestBody";
import { recordWebhookFailureSpike } from "@/lib/webhookFailureSpike";
import { HTTP_STATUS } from "@/lib/httpStatus";
import {
  RESEND_RECIPIENT_ACTION,
  resendRecipientAction,
} from "@/lib/resendWebhookEventState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESEND_WEBHOOK_RETRY_AFTER_MS = 5 * 60 * 1000;
const RESEND_WEBHOOK_BODY_MAX_BYTES = 256 * 1024;
const RESEND_WEBHOOK_RETRY_AFTER_SECONDS = Math.ceil(RESEND_WEBHOOK_RETRY_AFTER_MS / 1000);

function emailsFromEvent(event: WebhookEventPayload): string[] {
  const to = "to" in event.data ? event.data.to : [];
  if (Array.isArray(to)) return to.filter(Boolean);
  return typeof to === "string" && to ? [to] : [];
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

type SafeResendWebhookDetails = {
  svixId: string;
  type: string;
  recipientCount: number;
  recipientHashes: string[];
};

function safeResendWebhookDetails(
  event: WebhookEventPayload,
  svixId: string,
  emails: string[],
): SafeResendWebhookDetails {
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
    const action = resendRecipientAction(event.type);
    const emails = emailsFromEvent(event);
    const safeDetails = safeResendWebhookDetails(event, id, emails);

    if (
      action === RESEND_RECIPIENT_ACTION.SUPPRESS_BOUNCE
      || action === RESEND_RECIPIENT_ACTION.SUPPRESS_COMPLAINT
    ) {
      const reason = action === RESEND_RECIPIENT_ACTION.SUPPRESS_BOUNCE
        ? EmailSuppressionReason.BOUNCE
        : EmailSuppressionReason.COMPLAINT;
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

    if (action === RESEND_RECIPIENT_ACTION.OBSERVE_PROVIDER_FAILURE) {
      Sentry.captureMessage("Resend reported an email send failure", {
        level: "warning",
        tags: { source: "resend_webhook_provider_failure" },
        extra: safeDetails,
      });
      await markWebhookProcessed(id);
      return NextResponse.json({
        ok: true,
        type: event.type,
        providerFailure: true,
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
