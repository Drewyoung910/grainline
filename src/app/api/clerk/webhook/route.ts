// src/app/api/clerk/webhook/route.ts
import { Webhook } from "svix";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { sendWelcomeBuyer, sendWelcomeSeller } from "@/lib/email";
import { prisma } from "@/lib/db";
import { anonymizeUserAccountByClerkId } from "@/lib/accountDeletion";

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

  if (event.type === "user.deleted") {
    await anonymizeUserAccountByClerkId(event.data.id);
    return NextResponse.json({ ok: true });
  }

  if (event.type !== "user.created" && event.type !== "user.updated") {
    return NextResponse.json({ ok: true });
  }

  const { id, first_name, last_name, email_addresses, primary_email_address_id, image_url, unsafe_metadata, legal_accepted_at } = event.data;

  const name = [first_name, last_name].filter(Boolean).join(" ") || null;
  const email =
    email_addresses?.find((e) => e.id === primary_email_address_id)?.email_address ??
    email_addresses?.[0]?.email_address;

  const user = await ensureUserByClerkId(id, {
    ...(email ? { email } : {}),
    name,
    imageUrl: image_url ?? null,
  });

  const termsAcceptedAt =
    dateFromMetadata(unsafe_metadata?.termsAcceptedAt) ?? dateFromMetadata(legal_accepted_at);
  const ageAttestedAt = dateFromMetadata(unsafe_metadata?.ageAttestedAt);
  const termsVersion =
    typeof unsafe_metadata?.termsVersion === "string" ? unsafe_metadata.termsVersion.slice(0, 50) : undefined;

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
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({ ok: true });
}
