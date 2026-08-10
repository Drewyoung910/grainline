import { headers } from "next/headers";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { recordWebhookFailureSpike } from "@/lib/webhookFailureSpike";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { isRequestBodyTooLargeError, readBoundedText } from "@/lib/requestBody";
import {
  beginStripeWebhookEvent,
  markStripeWebhookEventFailed,
  markStripeWebhookEventProcessed,
} from "@/lib/stripeWebhookEvents";
import { processStripePayoutFailedEvent } from "@/lib/stripePayoutWebhook";
import { stripeWebhookCreatedSeconds } from "@/lib/stripeConnectV2";
import { isStaleStripeEvent } from "@/lib/stripeWebhookState";
import { sanitizeEmailOutboxError } from "@/lib/emailOutboxSanitize";

export const runtime = "nodejs";
export const maxDuration = 30;

const STRIPE_CONNECT_WEBHOOK_BODY_MAX_BYTES = 512 * 1024;
const STRIPE_CONNECT_WEBHOOK_RETRY_AFTER_SECONDS = 30;

export async function POST(req: Request) {
  const signature = (await headers()).get("stripe-signature");
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

  if (!secret) {
    Sentry.captureMessage("Stripe Connect webhook secret is not configured", {
      level: "fatal",
      tags: { source: "stripe_connect_webhook_config" },
    });
    await recordWebhookFailureSpike({
      webhook: "stripe_connect",
      kind: "config",
      status: HTTP_STATUS.SERVICE_UNAVAILABLE,
    });
    return NextResponse.json(
      { error: "Webhook temporarily unavailable" },
      { status: HTTP_STATUS.SERVICE_UNAVAILABLE },
    );
  }
  if (!signature) {
    Sentry.captureMessage("Stripe Connect webhook signature header missing", {
      level: "warning",
      tags: { source: "stripe_connect_webhook_signature" },
    });
    await recordWebhookFailureSpike({
      webhook: "stripe_connect",
      kind: "signature",
      status: HTTP_STATUS.BAD_REQUEST,
    });
    return NextResponse.json(
      { error: "Missing Stripe signature" },
      { status: HTTP_STATUS.BAD_REQUEST },
    );
  }

  let body = "";
  try {
    body = await readBoundedText(req, STRIPE_CONNECT_WEBHOOK_BODY_MAX_BYTES);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      Sentry.captureMessage("Stripe Connect webhook payload is too large", {
        level: "warning",
        tags: { source: "stripe_connect_webhook_payload" },
        extra: { maxBytes: error.maxBytes },
      });
      await recordWebhookFailureSpike({
        webhook: "stripe_connect",
        kind: "payload",
        status: HTTP_STATUS.PAYLOAD_TOO_LARGE,
      });
      return NextResponse.json(
        { error: "Payload too large" },
        { status: HTTP_STATUS.PAYLOAD_TOO_LARGE },
      );
    }
    throw error;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (error) {
    console.error(
      "Stripe Connect webhook signature verification failed:",
      sanitizeEmailOutboxError(error),
    );
    Sentry.captureException(error, {
      tags: { source: "stripe_connect_webhook_signature" },
    });
    await recordWebhookFailureSpike({
      webhook: "stripe_connect",
      kind: "signature",
      status: HTTP_STATUS.BAD_REQUEST,
    });
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: HTTP_STATUS.BAD_REQUEST },
    );
  }

  // The provider contract subscribes this separately signed Connect endpoint
  // only to payout.failed. A valid but unexpected event is acknowledged before
  // lease acquisition so configuration drift cannot pollute the durable ledger
  // or create a retry storm.
  if (event.type !== "payout.failed") {
    return NextResponse.json({ received: true, ignored: true });
  }

  const eventCreatedSeconds = stripeWebhookCreatedSeconds(
    (event as { created?: number | string | null }).created,
  );
  if (isStaleStripeEvent(eventCreatedSeconds)) {
    Sentry.captureMessage("Stripe Connect webhook event is too old", {
      level: "warning",
      tags: { source: "stripe_connect_webhook_stale_event" },
      extra: {
        stripeEventId: event.id,
        stripeEventType: event.type,
        stripeEventCreated: event.created,
      },
    });
    await recordWebhookFailureSpike({
      webhook: "stripe_connect",
      kind: "stale_event",
      status: HTTP_STATUS.BAD_REQUEST,
      extra: { stripeEventId: event.id, stripeEventType: event.type },
    });
    return NextResponse.json(
      { error: "Stale Stripe event" },
      { status: HTTP_STATUS.BAD_REQUEST },
    );
  }

  let reservation: Awaited<ReturnType<typeof beginStripeWebhookEvent>>;
  try {
    const sourceObjectId = (event.data.object as { id?: unknown }).id;
    if (typeof sourceObjectId !== "string" || sourceObjectId.length === 0) {
      throw new Error("Stripe Connect webhook event object is missing its source id");
    }
    reservation = await beginStripeWebhookEvent(
      event.id,
      event.type,
      sourceObjectId,
    );
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "stripe_connect_webhook_reservation" },
      extra: { stripeEventId: event.id, stripeEventType: event.type },
    });
    await recordWebhookFailureSpike({
      webhook: "stripe_connect",
      kind: "reservation",
      status: HTTP_STATUS.SERVICE_UNAVAILABLE,
      extra: { stripeEventId: event.id, stripeEventType: event.type },
    });
    return NextResponse.json(
      { error: "Webhook temporarily unavailable" },
      { status: HTTP_STATUS.SERVICE_UNAVAILABLE },
    );
  }

  if (reservation.action === "processed") {
    return NextResponse.json({ received: true });
  }
  if (reservation.action === "in_progress") {
    return NextResponse.json(
      { received: false, status: reservation.action },
      {
        status: HTTP_STATUS.SERVICE_UNAVAILABLE,
        headers: {
          "Retry-After": String(STRIPE_CONNECT_WEBHOOK_RETRY_AFTER_SECONDS),
        },
      },
    );
  }
  const claimGeneration = reservation.claimGeneration;

  try {
    await processStripePayoutFailedEvent(event);
    await markStripeWebhookEventProcessed(event.id, claimGeneration);
    return NextResponse.json({ received: true });
  } catch (error) {
    try {
      await markStripeWebhookEventFailed(event.id, claimGeneration, error);
    } catch (markError) {
      Sentry.captureException(markError, {
        tags: { source: "stripe_connect_webhook_mark_failed" },
        extra: { stripeEventId: event.id, stripeEventType: event.type },
      });
    }
    console.error("Stripe Connect webhook handler error:", sanitizeEmailOutboxError(error));
    Sentry.captureException(error, {
      tags: { source: "stripe_connect_webhook_handler" },
      extra: { stripeEventId: event.id, stripeEventType: event.type },
    });
    await recordWebhookFailureSpike({
      webhook: "stripe_connect",
      kind: "handler",
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      extra: { stripeEventId: event.id, stripeEventType: event.type },
    });
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR },
    );
  }
}
