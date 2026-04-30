// src/app/api/clerk/webhook/route.ts
import { Webhook } from "svix";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { sendWelcomeBuyer, sendWelcomeSeller } from "@/lib/email";
import { prisma } from "@/lib/db";
import { anonymizeUserAccountByClerkId } from "@/lib/accountDeletion";
import { shouldRevokeSessionsForClerkEmailChange } from "@/lib/clerkSessionSecurity";
import { revokeClerkUserSessions } from "@/lib/clerkUserLifecycle";
import { sanitizeUserName, truncateText } from "@/lib/sanitize";
import * as Sentry from "@sentry/nextjs";

interface ClerkEmailAddress {
  id?: string | null;
  email_address: string;
}

interface ClerkUserEvent {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email_addresses: ClerkEmailAddress[];
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

function isUniqueViolation(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002";
}

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  return String(err);
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
      lastError: truncateText(errorMessage(err), 2000),
    },
  });
}

export async function POST(req: Request) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Missing CLERK_WEBHOOK_SECRET" }, { status: 500 });
  }

  const headerPayload = await headers();
  const svixId = headerPayload.get("svix-id");
  const svixTimestamp = headerPayload.get("svix-timestamp");
  const svixSignature = headerPayload.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing svix headers" }, { status: 400 });
  }

  const body = await req.text();

  const wh = new Webhook(webhookSecret);
  let event: { type: string; data: ClerkUserEvent };
  try {
    event = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as { type: string; data: ClerkUserEvent };
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const reservation = await reserveClerkWebhookEvent(svixId, event.type);
  if (reservation !== "process") {
    return NextResponse.json({ ok: true });
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

  const { id, first_name, last_name, email_addresses, primary_email_address_id, image_url, unsafe_metadata, legal_accepted_at } = event.data;

  const name = sanitizeUserName([first_name, last_name].filter(Boolean).join(" ")) || null;
  const email =
    email_addresses?.find((e) => e.id === primary_email_address_id)?.email_address ??
    email_addresses?.[0]?.email_address;

  const existingLocalUser = await prisma.user.findUnique({
    where: { clerkId: id },
    select: { id: true, email: true, banned: true, deletedAt: true },
  });
  if (existingLocalUser?.banned || existingLocalUser?.deletedAt) {
    await markClerkWebhookProcessed(svixId);
    return NextResponse.json({ ok: true });
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
  }

  if (event.type === "user.created" && email && !user.welcomeEmailSentAt) {
    try {
      await sendWelcomeBuyer({ user: { name, email } });
      const sellerProfile = await prisma.sellerProfile.findUnique({
        where: { userId: user.id },
        select: { displayName: true },
      });
      if (sellerProfile) {
        await sendWelcomeSeller({
          seller: { displayName: sellerProfile.displayName, email },
        });
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { welcomeEmailSentAt: new Date() },
      });
    } catch (error) {
      Sentry.captureException(error, {
        tags: { source: "clerk_webhook_welcome_email" },
        extra: { svixId, clerkId: id, userId: user.id },
      });
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
    throw error;
  }
}
