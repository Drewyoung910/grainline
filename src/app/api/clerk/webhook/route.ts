// src/app/api/clerk/webhook/route.ts
import { Webhook } from "svix";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import {
  renderWelcomeBuyerEmail,
  renderWelcomeSellerEmail,
  sendRenderedEmail,
  type QueuedRenderedEmail,
} from "@/lib/email";
import { enqueueEmailOutbox } from "@/lib/emailOutbox";
import { prisma } from "@/lib/db";
import { anonymizeUserAccountByClerkId } from "@/lib/accountDeletion";
import {
  resolveClerkWebhookPrimaryEmail,
  shouldReserveClerkWelcomeEmail,
  type ClerkWebhookEmailAddress,
} from "@/lib/clerkWebhookEmail";
import { shouldRevokeSessionsForClerkEmailChange } from "@/lib/clerkSessionSecurity";
import { revokeClerkUserSessions } from "@/lib/clerkUserLifecycle";
import { emailSuppressionAddressKeys } from "@/lib/emailSuppression";
import { sanitizeUserName, truncateText } from "@/lib/sanitize";
import { isRequestBodyTooLargeError, readBoundedText } from "@/lib/requestBody";
import { invalidateAccountStateCache } from "@/lib/accountStateCache";
import { recordWebhookFailureSpike } from "@/lib/webhookFailureSpike";
import { sanitizeEmailOutboxError } from "@/lib/emailOutboxSanitize";
import * as Sentry from "@sentry/nextjs";

interface ClerkUserEvent {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email_addresses: ClerkWebhookEmailAddress[];
  primary_email_address_id?: string | null;
  image_url: string | null;
  unsafe_metadata?: Record<string, unknown>;
  legal_accepted_at?: number | string | null;
}

function dateFromMetadata(value: unknown): Date | null {
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "number") {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

const CLERK_WEBHOOK_RETRY_AFTER_MS = 5 * 60 * 1000;
const CLERK_WEBHOOK_BODY_MAX_BYTES = 512 * 1024;
const CLERK_WEBHOOK_RETRY_AFTER_SECONDS = Math.ceil(CLERK_WEBHOOK_RETRY_AFTER_MS / 1000);

function isUniqueViolation(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002";
}

async function enqueueWelcomeFallbackEmail(
  email: QueuedRenderedEmail,
  dedupKey: string,
  userId: string,
) {
  await enqueueEmailOutbox({
    to: email.to,
    subject: email.subject,
    html: email.html,
    dedupKey,
    templateName: "welcome",
    userId,
  });
}

async function reserveClerkWebhookEvent(svixId: string, type: string): Promise<"process" | "processed" | "in_progress"> {
  const now = new Date();
  try {
    await prisma.clerkWebhookEvent.create({
      data: { svixId, type, processingStartedAt: now },
    });
    return "process";
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }

  const existing = await prisma.clerkWebhookEvent.findUnique({
    where: { svixId },
    select: { processedAt: true, processingStartedAt: true },
  });
  if (existing?.processedAt) return "processed";

  const retryBefore = new Date(now.getTime() - CLERK_WEBHOOK_RETRY_AFTER_MS);
  const claimed = await prisma.clerkWebhookEvent.updateMany({
    where: {
      svixId,
      processedAt: null,
      OR: [
        { lastError: { not: null } },
        { processingStartedAt: null },
        { processingStartedAt: { lt: retryBefore } },
      ],
    },
    data: {
      type,
      processingStartedAt: now,
      lastError: null,
    },
  });

  return claimed.count === 1 ? "process" : "in_progress";
}

async function markClerkWebhookProcessed(svixId: string) {
  await prisma.clerkWebhookEvent.update({
    where: { svixId },
    data: { processedAt: new Date(), lastError: null },
  });
}

async function markClerkWebhookFailed(svixId: string, err: unknown) {
  await prisma.clerkWebhookEvent.updateMany({
    where: { svixId, processedAt: null },
    data: {
      processingStartedAt: null,
      lastError: truncateText(sanitizeEmailOutboxError(err), 2000),
    },
  });
}

export async function POST(req: Request) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    Sentry.captureMessage("Clerk webhook secret is not configured", {
      level: "fatal",
      tags: { source: "clerk_webhook_config" },
    });
    await recordWebhookFailureSpike({ webhook: "clerk", kind: "config", status: 500 });
    return NextResponse.json({ error: "Missing CLERK_WEBHOOK_SECRET" }, { status: 500 });
  }

  const headerPayload = await headers();
  const svixId = headerPayload.get("svix-id");
  const svixTimestamp = headerPayload.get("svix-timestamp");
  const svixSignature = headerPayload.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    Sentry.captureMessage("Clerk webhook signature headers missing", {
      level: "warning",
      tags: { source: "clerk_webhook_signature" },
      extra: {
        hasSvixId: Boolean(svixId),
        hasSvixTimestamp: Boolean(svixTimestamp),
        hasSvixSignature: Boolean(svixSignature),
      },
    });
    await recordWebhookFailureSpike({ webhook: "clerk", kind: "signature", status: 400 });
    return NextResponse.json({ error: "Missing svix headers" }, { status: 400 });
  }

  let body = "";
  try {
    body = await readBoundedText(req, CLERK_WEBHOOK_BODY_MAX_BYTES);
  } catch (err) {
    if (isRequestBodyTooLargeError(err)) {
      Sentry.captureMessage("Clerk webhook payload is too large", {
        level: "warning",
        tags: { source: "clerk_webhook_payload" },
        extra: { maxBytes: err.maxBytes, svixId },
      });
      await recordWebhookFailureSpike({ webhook: "clerk", kind: "payload", status: 413 });
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    throw err;
  }

  const wh = new Webhook(webhookSecret);
  let event: { type: string; data: ClerkUserEvent };
  try {
    event = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as { type: string; data: ClerkUserEvent };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { source: "clerk_webhook_verify" },
      extra: { svixId, svixTimestamp },
    });
    await recordWebhookFailureSpike({ webhook: "clerk", kind: "signature", status: 400 });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let reservation: Awaited<ReturnType<typeof reserveClerkWebhookEvent>>;
  try {
    reservation = await reserveClerkWebhookEvent(svixId, event.type);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "clerk_webhook_reservation" },
      extra: { svixId, eventType: event.type },
    });
    await recordWebhookFailureSpike({
      webhook: "clerk",
      kind: "reservation",
      status: 503,
      extra: { svixId, eventType: event.type },
    });
    return NextResponse.json({ error: "Webhook temporarily unavailable" }, { status: 503 });
  }
  if (reservation === "processed") {
    return NextResponse.json({ ok: true });
  }
  if (reservation === "in_progress") {
    return NextResponse.json(
      { ok: false, status: reservation },
      { status: 503, headers: { "Retry-After": String(CLERK_WEBHOOK_RETRY_AFTER_SECONDS) } },
    );
  }

  try {
    if (event.type === "user.deleted") {
      await anonymizeUserAccountByClerkId(event.data.id);
      await markClerkWebhookProcessed(svixId);
      return NextResponse.json({ ok: true });
    }

    if (event.type !== "user.created" && event.type !== "user.updated") {
      await markClerkWebhookProcessed(svixId);
      return NextResponse.json({ ok: true });
    }

    const {
      id,
      first_name,
      last_name,
      email_addresses,
      primary_email_address_id,
      image_url,
      unsafe_metadata,
      legal_accepted_at,
    } = event.data;

    const name = sanitizeUserName([first_name, last_name].filter(Boolean).join(" ")) || null;
    const emailResolution = resolveClerkWebhookPrimaryEmail({
      emailAddresses: email_addresses,
      primaryEmailAddressId: primary_email_address_id,
    });
    const email = emailResolution.email;
    if (emailResolution.reason !== "resolved") {
      Sentry.captureMessage("Clerk webhook primary email unavailable", {
        level: "warning",
        tags: {
          source: "clerk_webhook_primary_email",
          reason: emailResolution.reason,
          eventType: event.type,
        },
        extra: {
          svixId,
          clerkId: id,
          primaryEmailAddressId: primary_email_address_id ?? null,
          emailAddressCount: email_addresses?.length ?? 0,
        },
      });
    }

    const existingLocalUser = await prisma.user.findUnique({
      where: { clerkId: id },
      select: { id: true, email: true, banned: true, deletedAt: true },
    });
    if (existingLocalUser?.banned || existingLocalUser?.deletedAt) {
      await markClerkWebhookProcessed(svixId);
      return NextResponse.json({ ok: true });
    }

    if (event.type === "user.created") {
      const suppressionEmailKeys = emailSuppressionAddressKeys(email);
      if (suppressionEmailKeys.length > 0) {
        await prisma.emailSuppression.deleteMany({
          where: { email: { in: suppressionEmailKeys }, source: "account_deletion" },
        });
      }
    }

    if (
      shouldRevokeSessionsForClerkEmailChange({
        eventType: event.type,
        clerkUserId: id,
        previousEmail: existingLocalUser?.email,
        nextEmail: email,
      })
    ) {
      const result = await revokeClerkUserSessions(id);
      Sentry.captureMessage("Clerk email change revoked active sessions", {
        level: "info",
        tags: { source: "clerk_email_change_session_revoke" },
        extra: {
          svixId,
          clerkId: id,
          userId: existingLocalUser?.id,
          revokedSessionCount: result.revokedSessionCount,
        },
      });
    }

    const user = await ensureUserByClerkId(id, {
      ...(email ? { email } : {}),
      name,
      imageUrl: image_url ?? null,
    });

    const termsAcceptedAt =
      dateFromMetadata(unsafe_metadata?.termsAcceptedAt) ?? dateFromMetadata(legal_accepted_at);
    const ageAttestedAt = dateFromMetadata(unsafe_metadata?.ageAttestedAt);
    const termsVersion =
      typeof unsafe_metadata?.termsVersion === "string" ? truncateText(unsafe_metadata.termsVersion, 50) : undefined;

    if (termsAcceptedAt || ageAttestedAt || termsVersion) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          ...(termsAcceptedAt ? { termsAcceptedAt } : {}),
          ...(ageAttestedAt ? { ageAttestedAt } : {}),
          ...(termsVersion ? { termsVersion } : {}),
        },
      });
      await invalidateAccountStateCache(id, "clerk_webhook_terms_account_state_cache_invalidate");
    }

    if (
      shouldReserveClerkWelcomeEmail({
        eventType: event.type,
        email,
        welcomeEmailSentAt: user.welcomeEmailSentAt,
      })
    ) {
      const welcomeEmail = email;
      if (!welcomeEmail) {
        await markClerkWebhookProcessed(svixId);
        return NextResponse.json({ ok: true });
      }

      const reserved = await prisma.user.updateMany({
        where: { id: user.id, welcomeEmailSentAt: null },
        data: { welcomeEmailSentAt: new Date() },
      });
      if (reserved.count !== 1) {
        await markClerkWebhookProcessed(svixId);
        return NextResponse.json({ ok: true });
      }

      const sellerProfile = await prisma.sellerProfile.findUnique({
        where: { userId: user.id },
        select: { displayName: true },
      });
      const buyerWelcomeEmail = renderWelcomeBuyerEmail({ user: { name, email: welcomeEmail } });
      const sellerWelcomeEmail = sellerProfile
        ? renderWelcomeSellerEmail({
            seller: { displayName: sellerProfile.displayName, email: welcomeEmail },
          })
        : null;

      try {
        await sendRenderedEmail(buyerWelcomeEmail, { throwOnFailure: true });
        if (sellerWelcomeEmail) {
          await sendRenderedEmail(sellerWelcomeEmail, { throwOnFailure: true });
        }
      } catch (error) {
        Sentry.captureException(error, {
          tags: { source: "clerk_webhook_welcome_email" },
          extra: { svixId, clerkId: id, userId: user.id },
        });
        await enqueueWelcomeFallbackEmail(buyerWelcomeEmail, `welcome-buyer:${user.id}`, user.id).catch((enqueueError) => {
          Sentry.captureException(enqueueError, {
            tags: { source: "clerk_webhook_welcome_email_outbox" },
            extra: { svixId, clerkId: id, userId: user.id, kind: "buyer" },
          });
        });
        if (sellerWelcomeEmail) {
          await enqueueWelcomeFallbackEmail(sellerWelcomeEmail, `welcome-seller:${user.id}`, user.id).catch((enqueueError) => {
            Sentry.captureException(enqueueError, {
              tags: { source: "clerk_webhook_welcome_email_outbox" },
              extra: { svixId, clerkId: id, userId: user.id, kind: "seller" },
            });
          });
        }
      }
    }

    await markClerkWebhookProcessed(svixId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    await markClerkWebhookFailed(svixId, error).catch((markError) => {
      Sentry.captureException(markError, {
        tags: { source: "clerk_webhook_mark_failed" },
        extra: { svixId, eventType: event.type },
      });
    });
    Sentry.captureException(error, {
      tags: { source: "clerk_webhook" },
      extra: { svixId, eventType: event.type },
    });
    await recordWebhookFailureSpike({
      webhook: "clerk",
      kind: "handler",
      status: 500,
      extra: { svixId, eventType: event.type },
    });
    throw error;
  }
}
