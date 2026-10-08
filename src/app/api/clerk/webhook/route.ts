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
  shouldReserveClerkWelcomeEmail,
} from "@/lib/clerkWebhookEmail";
import { shouldRevokeSessionsForClerkEmailChange } from "@/lib/clerkSessionSecurity";
import {
  getCurrentClerkUserIdentity,
  isClerkUserNotFoundError,
  revokeClerkUserSessions,
} from "@/lib/clerkUserLifecycle";
import {
  markClerkWebhookFailed,
  markClerkWebhookProcessed,
  reserveClerkWebhookEvent,
} from "@/lib/clerkWebhookEvents";
import { emailSuppressionAddressKeys } from "@/lib/emailSuppression";
import { sanitizeUserName } from "@/lib/sanitize";
import { isRequestBodyTooLargeError, readBoundedWebhookText as readBoundedText } from "@/lib/requestBody";
import { recordWebhookFailureSpike } from "@/lib/webhookFailureSpike";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { prepareClerkSentinelReceipt } from "@/lib/clerkWebhookReceipt.mjs";
import {
  reserveUserClerkWelcomeEmail,
  userClerkLifecycleState,
} from "@/lib/userIdentityAccess";
import * as Sentry from "@sentry/nextjs";

interface ClerkUserEvent {
  id: string;
}

const CLERK_WEBHOOK_RETRY_AFTER_MS = 5 * 60 * 1000;
const CLERK_WEBHOOK_BODY_MAX_BYTES = 512 * 1024;
const CLERK_WEBHOOK_RETRY_AFTER_SECONDS = Math.ceil(CLERK_WEBHOOK_RETRY_AFTER_MS / 1000);

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

export async function POST(req: Request) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Missing CLERK_WEBHOOK_SECRET" },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR },
    );
  }

  const headerPayload = await headers();
  const svixId = headerPayload.get("svix-id");
  const svixTimestamp = headerPayload.get("svix-timestamp");
  const svixSignature = headerPayload.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing svix headers" }, { status: HTTP_STATUS.BAD_REQUEST });
  }

  let body = "";
  try {
    body = await readBoundedText(req, CLERK_WEBHOOK_BODY_MAX_BYTES);
  } catch (err) {
    if (isRequestBodyTooLargeError(err)) {
      return NextResponse.json({ error: "Payload too large" }, { status: HTTP_STATUS.PAYLOAD_TOO_LARGE });
    }
    // Body-stream failures (including a caller disconnecting mid-request) are
    // still pre-authentication input failures. Do not throw them into the
    // route-level Sentry wrapper and let unauthenticated traffic consume
    // shared telemetry capacity.
    return NextResponse.json({ error: "Invalid body" }, { status: HTTP_STATUS.BAD_REQUEST });
  }

  const wh = new Webhook(webhookSecret);
  let event: { type: string; data: ClerkUserEvent };
  try {
    event = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as { type: string; data: ClerkUserEvent };
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: HTTP_STATUS.BAD_REQUEST });
  }

  const sentinelReceipt = prepareClerkSentinelReceipt({ body, svixId, svixTimestamp, verifiedEvent: event, secret: webhookSecret });
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
      status: HTTP_STATUS.SERVICE_UNAVAILABLE,
      extra: { svixId, eventType: event.type },
    });
    return NextResponse.json(
      { error: "Webhook temporarily unavailable" },
      { status: HTTP_STATUS.SERVICE_UNAVAILABLE },
    );
  }
  if (reservation.action === "processed") {
    const receipt = sentinelReceipt?.("duplicate");
    return NextResponse.json({ ok: true, ...(receipt ? { receipt } : {}) });
  }
  if (reservation.action === "in_progress") {
    return NextResponse.json(
      { ok: false, status: reservation.action },
      { status: HTTP_STATUS.SERVICE_UNAVAILABLE, headers: { "Retry-After": String(CLERK_WEBHOOK_RETRY_AFTER_SECONDS) } },
    );
  }
  const claimGeneration = reservation.claimGeneration;

  try {
    if (event.type === "user.deleted") {
      const anonymized = await anonymizeUserAccountByClerkId(event.data.id);
      if ("inProgress" in anonymized && anonymized.inProgress) {
        const retryError = new Error("Clerk user.deleted local anonymization is already in progress");
        await markClerkWebhookFailed(svixId, claimGeneration, retryError).catch((markError) => {
          Sentry.captureException(markError, {
            tags: { source: "clerk_webhook_mark_failed" },
            extra: { svixId, eventType: event.type },
          });
        });
        Sentry.captureMessage("Clerk user.deleted local anonymization is already in progress", {
          level: "warning",
          tags: { source: "clerk_webhook_user_deleted_in_progress" },
          extra: { svixId, clerkId: event.data.id },
        });
        await recordWebhookFailureSpike({
          webhook: "clerk",
          kind: "handler",
          status: HTTP_STATUS.SERVICE_UNAVAILABLE,
          extra: { svixId, eventType: event.type },
        });
        return NextResponse.json(
          { ok: false, status: "in_progress" },
          { status: HTTP_STATUS.SERVICE_UNAVAILABLE, headers: { "Retry-After": String(CLERK_WEBHOOK_RETRY_AFTER_SECONDS) } },
        );
      }
      await markClerkWebhookProcessed(svixId, claimGeneration);
      const receipt = "userAbsent" in anonymized && anonymized.userAbsent === true ? sentinelReceipt?.("absent-user") : null;
      return NextResponse.json({ ok: true, ...(receipt ? { receipt } : {}) });
    }

    if (event.type !== "user.created" && event.type !== "user.updated") {
      await markClerkWebhookProcessed(svixId, claimGeneration);
      return NextResponse.json({ ok: true });
    }

    const { id } = event.data;

    const existingLocalUser = await userClerkLifecycleState(prisma, id);
    if (existingLocalUser?.banned || existingLocalUser?.deletedAt) {
      await markClerkWebhookProcessed(svixId, claimGeneration);
      return NextResponse.json({ ok: true });
    }

    // Clerk does not guarantee webhook delivery order. Read current provider
    // state after authenticating the event so an older signed payload cannot
    // overwrite newer identity data.
    let currentIdentity: Awaited<ReturnType<typeof getCurrentClerkUserIdentity>>;
    try {
      currentIdentity = await getCurrentClerkUserIdentity(id);
    } catch (error) {
      // A signed create/update event can arrive after the provider account was
      // deleted. That is terminal for this event: do not resurrect the user or
      // retain an unresolvable failed lease forever.
      if (isClerkUserNotFoundError(error)) {
        await markClerkWebhookProcessed(svixId, claimGeneration);
        return NextResponse.json({ ok: true });
      }
      throw error;
    }
    const name = sanitizeUserName(
      [currentIdentity.firstName, currentIdentity.lastName].filter(Boolean).join(" "),
    ) || null;
    const email = currentIdentity.primaryEmail;
    if (currentIdentity.emailResolution !== "resolved") {
      Sentry.captureMessage("Clerk current primary email unavailable", {
        level: "warning",
        tags: {
          source: "clerk_webhook_primary_email",
          reason: currentIdentity.emailResolution,
          eventType: event.type,
        },
        extra: { svixId, clerkId: id },
      });
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
      imageUrl: currentIdentity.imageUrl,
    });

    if (
      shouldReserveClerkWelcomeEmail({
        eventType: event.type,
        email,
        welcomeEmailSentAt: user.welcomeEmailSentAt,
      })
    ) {
      const welcomeEmail = email;
      if (!welcomeEmail) {
        await markClerkWebhookProcessed(svixId, claimGeneration);
        return NextResponse.json({ ok: true });
      }

      const reserved = await reserveUserClerkWelcomeEmail(prisma, {
        clerkId: id,
        userId: user.id,
      });
      if (!reserved) {
        await markClerkWebhookProcessed(svixId, claimGeneration);
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

    await markClerkWebhookProcessed(svixId, claimGeneration);
    return NextResponse.json({ ok: true });
  } catch (error) {
    await markClerkWebhookFailed(svixId, claimGeneration, error).catch((markError) => {
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
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      extra: { svixId, eventType: event.type },
    });
    throw error;
  }
}
