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
  requireResendRecipientTasks,
  RESEND_RECIPIENT_ACTION,
  resendRecipientAction,
  resendSuppressionReason,
  resendSuppressionSource,
} from "@/lib/resendWebhookEventState";
import {
  completeResendWebhookEvent,
  failResendWebhookEvent,
  reserveResendWebhookEvent,
  type ResendWebhookLease,
} from "@/lib/emailServiceAccess";

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

async function reserveWebhookEvent(svixId: string, type: string) {
  const now = new Date();
  const retryBefore = new Date(now.getTime() - RESEND_WEBHOOK_RETRY_AFTER_MS);
  return reserveResendWebhookEvent(prisma, {
    svixId,
    type,
    now,
    retryBefore,
  });
}

async function markWebhookProcessed(svixId: string, lease: ResendWebhookLease) {
  await completeResendWebhookEvent(prisma, {
    ...lease,
    svixId,
    now: new Date(),
  });
}

async function markWebhookFailed(
  svixId: string,
  lease: ResendWebhookLease,
  err: unknown,
) {
  await failResendWebhookEvent(prisma, {
    ...lease,
    svixId,
    error: sanitizeEmailOutboxError(err),
    now: new Date(),
  });
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
  // Nothing below this point has proved it came from the provider. Junk requests must
  // not spend Sentry events or Redis commands, or a flood could blind monitoring and
  // exhaust the budget the fail-closed limiters depend on.
  if (!id || !timestamp || !signature) {
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
  } catch {
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
  if (reservation.action === "processed") {
    return NextResponse.json({ ok: true, duplicate: true, status: reservation.action, type: event.type });
  }
  if (reservation.action === "in_progress") {
    return NextResponse.json(
      { ok: false, duplicate: true, status: reservation.action, type: event.type },
      { status: HTTP_STATUS.SERVICE_UNAVAILABLE, headers: { "Retry-After": String(RESEND_WEBHOOK_RETRY_AFTER_SECONDS) } },
    );
  }

  try {
    const action = resendRecipientAction(
      event.type,
      event.type === "email.bounced" ? event.data.bounce.type : undefined,
    );
    const emails = emailsFromEvent(event);
    const safeDetails = safeResendWebhookDetails(event, id, emails);
    const suppressionReason = resendSuppressionReason(action);
    const suppressionSource = resendSuppressionSource(action);

    if (suppressionReason && suppressionSource) {
      const reason = suppressionReason === "COMPLAINT"
        ? EmailSuppressionReason.COMPLAINT
        : EmailSuppressionReason.BOUNCE;
      await requireResendRecipientTasks(
        emails.map((email) =>
          suppressEmail({
            email,
            reason,
            source: suppressionSource,
            eventId: id,
            details: safeDetails,
          }),
        ),
        "resend_webhook_suppress_email",
        (reason, recipientIndex) => {
          Sentry.captureException(reason, {
            tags: { source: "resend_webhook_suppress_email" },
            extra: { svixId: id, type: event.type, recipientIndex },
          });
        },
      );
      await markWebhookProcessed(id, reservation);
      return NextResponse.json({ ok: true, type: event.type, suppressed: emails.length });
    }

    if (action === RESEND_RECIPIENT_ACTION.OBSERVE_PROVIDER_FAILURE) {
      Sentry.captureMessage("Resend reported an email send failure", {
        level: "warning",
        tags: { source: "resend_webhook_provider_failure" },
        extra: safeDetails,
      });
      await markWebhookProcessed(id, reservation);
      return NextResponse.json({
        ok: true,
        type: event.type,
        providerFailure: true,
      });
    }

    await markWebhookProcessed(id, reservation);
    return NextResponse.json({ ok: true, ignored: true, type: event.type });
  } catch (err) {
    await markWebhookFailed(id, reservation, err).catch((markError) => {
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
