// src/app/api/clerk/webhook/route.ts
import { Webhook } from "svix";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { sendWelcomeBuyer, sendWelcomeSeller } from "@/lib/email";
import { prisma } from "@/lib/db";

interface ClerkEmailAddress {
  email_address: string;
}

interface ClerkUserEvent {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email_addresses: ClerkEmailAddress[];
  image_url: string | null;
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

  if (event.type !== "user.created" && event.type !== "user.updated") {
    return NextResponse.json({ ok: true });
  }

  const { id, first_name, last_name, email_addresses, image_url } = event.data;

  const name = [first_name, last_name].filter(Boolean).join(" ") || null;
  const email = email_addresses?.[0]?.email_address;

  const user = await ensureUserByClerkId(id, {
    ...(email ? { email } : {}),
    name,
    imageUrl: image_url ?? null,
  });

  if (event.type === "user.created" && email) {
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
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({ ok: true });
}
