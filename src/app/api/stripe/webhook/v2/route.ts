import { headers } from "next/headers";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { stripe } from "@/lib/stripe";
import { recordWebhookFailureSpike } from "@/lib/webhookFailureSpike";
import {
  beginStripeWebhookEvent,
  markStripeWebhookEventFailed,
  markStripeWebhookEventProcessed,
} from "@/lib/stripeWebhookEvents";
import {
  isStripeConnectV2AccountEvent,
  stripeConnectV2AccountIdFromNotification,
  stripeWebhookCreatedSeconds,
  type StripeConnectV2AccountNotification,
} from "@/lib/stripeConnectV2";
import { isStaleStripeEvent } from "@/lib/stripeWebhookState";
import { mirrorStripeChargesEnabled } from "@/lib/stripeWebhookMirror";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "iad1";

type StripeConnectV2NotificationEnvelope = StripeConnectV2AccountNotification & {
  id?: unknown;
  type?: unknown;
  created?: unknown;
};

export async function POST(req: Request) {
  const body = await req.text();
  const signature = (await headers()).get("stripe-signature");
  const secret = process.env.STRIPE_V2_WEBHOOK_SECRET;

  if (!secret) {
    Sentry.captureMessage("Stripe v2 webhook secret is not configured", {
      level: "fatal",
      tags: { source: "stripe_v2_webhook_config" },
    });
    await recordWebhookFailureSpike({ webhook: "stripe_v2", kind: "config", status: 500 });
    return NextResponse.json({ error: "Webhook temporarily unavailable" }, { status: 500 });
  }
  if (!signature) {
    Sentry.captureMessage("Stripe v2 webhook signature header missing", {
      level: "warning",
      tags: { source: "stripe_v2_webhook_signature" },
    });
    await recordWebhookFailureSpike({ webhook: "stripe_v2", kind: "signature", status: 400 });
    return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });
  }

  let notification: StripeConnectV2NotificationEnvelope;
  try {
    notification = stripe.parseEventNotification(body, signature, secret) as StripeConnectV2NotificationEnvelope;
  } catch (err: unknown) {
    console.error("Stripe v2 webhook signature verification failed:", (err as { message?: string })?.message);
    Sentry.captureException(err, { tags: { source: "stripe_v2_webhook_signature" } });
    await recordWebhookFailureSpike({ webhook: "stripe_v2", kind: "signature", status: 400 });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const eventId = typeof notification.id === "string" ? notification.id : null;
  const eventType = typeof notification.type === "string" ? notification.type : null;
  if (!eventId || !eventType) {
    Sentry.captureMessage("Stripe v2 webhook notification missing id or type", {
      level: "warning",
      tags: { source: "stripe_v2_webhook_payload" },
      extra: { hasEventId: Boolean(eventId), eventType },
    });
    await recordWebhookFailureSpike({ webhook: "stripe_v2", kind: "payload", status: 400 });
    return NextResponse.json({ error: "Invalid Stripe notification" }, { status: 400 });
  }
  const stripeEventId = eventId;
  const stripeEventType = eventType;

  const eventCreatedSeconds = stripeWebhookCreatedSeconds(
    typeof notification.created === "number" || typeof notification.created === "string"
      ? notification.created
      : undefined,
  );
  if (isStaleStripeEvent(eventCreatedSeconds)) {
    Sentry.captureMessage("Stripe v2 webhook event is too old", {
      level: "warning",
      tags: { source: "stripe_v2_webhook_stale_event" },
      extra: { stripeEventId, stripeEventType, stripeEventCreated: notification.created },
    });
    await recordWebhookFailureSpike({
      webhook: "stripe_v2",
      kind: "stale_event",
      status: 400,
      extra: { stripeEventId, stripeEventType },
    });
    return NextResponse.json({ error: "Stale Stripe event" }, { status: 400 });
  }

  const shouldProcess = await beginStripeWebhookEvent(stripeEventId, stripeEventType);
  if (!shouldProcess) return NextResponse.json({ received: true });

  async function markCurrentStripeWebhookEventFailed(handlerErr: unknown) {
    try {
      await markStripeWebhookEventFailed(stripeEventId, handlerErr);
    } catch (markErr) {
      Sentry.captureException(markErr, {
        tags: { source: "stripe_v2_webhook_mark_failed" },
        extra: { stripeEventId, stripeEventType },
      });
    }
  }

  async function processIdempotentEvent(handler: () => Promise<NextResponse>): Promise<NextResponse> {
    try {
      const response = await handler();
      await markStripeWebhookEventProcessed(stripeEventId);
      return response;
    } catch (handlerErr) {
      await markCurrentStripeWebhookEventFailed(handlerErr);
      throw handlerErr;
    }
  }

  try {
    return await processIdempotentEvent(async () => {
      if (!isStripeConnectV2AccountEvent(stripeEventType)) {
        return NextResponse.json({ received: true, ignored: true });
      }

      const accountId = stripeConnectV2AccountIdFromNotification(notification);
      if (accountId) {
        const account = await stripe.accounts.retrieve(accountId);
        await mirrorStripeChargesEnabled({
          accountId,
          chargesEnabled: Boolean(account.charges_enabled),
          route: "/api/stripe/webhook/v2",
        });
      }

      return NextResponse.json({ received: true });
    });
  } catch (handlerErr) {
    Sentry.captureException(handlerErr, {
      tags: { source: "stripe_v2_webhook_handler" },
      extra: { stripeEventId, stripeEventType },
    });
    await recordWebhookFailureSpike({
      webhook: "stripe_v2",
      kind: "handler",
      status: 500,
      extra: { stripeEventId, stripeEventType },
    });
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}
