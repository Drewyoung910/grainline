import { EmailSuppressionReason, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { Resend, type WebhookEventPayload } from "resend";
import * as Sentry from "@sentry/nextjs";
import { suppressEmail } from "@/lib/emailSuppression";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function emailsFromEvent(event: WebhookEventPayload): string[] {
  const to = "to" in event.data ? event.data.to : [];
  return Array.isArray(to) ? to.filter(Boolean) : [];
}

function suppressionReason(type: string): EmailSuppressionReason | null {
  if (type === "email.bounced") return EmailSuppressionReason.BOUNCE;
  if (type === "email.complained" || type === "email.suppressed") return EmailSuppressionReason.COMPLAINT;
  return null;
}

export async function POST(request: Request) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!webhookSecret) {
    Sentry.captureMessage("RESEND_WEBHOOK_SECRET is not configured", { level: "error" });
    return NextResponse.json({ ok: false, error: "Webhook not configured" }, { status: 503 });
  }

  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!id || !timestamp || !signature) {
    return NextResponse.json({ ok: false, error: "Missing webhook signature headers" }, { status: 400 });
  }

  let event: WebhookEventPayload;
  const payload = await request.text();
  try {
    const resend = new Resend(process.env.RESEND_API_KEY || "re_webhook_verify_only");
    event = resend.webhooks.verify({
      webhookSecret,
      payload,
      headers: { id, timestamp, signature },
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { source: "resend_webhook_verify" } });
    return NextResponse.json({ ok: false, error: "Invalid webhook signature" }, { status: 400 });
  }

  const reason = suppressionReason(event.type);
  if (!reason) {
    return NextResponse.json({ ok: true, ignored: true, type: event.type });
  }

  const emails = emailsFromEvent(event);
  await Promise.all(
    emails.map((email) =>
      suppressEmail({
        email,
        reason,
        source: "resend",
        eventId: id,
        details: event as unknown as Prisma.InputJsonValue,
      }),
    ),
  );

  return NextResponse.json({ ok: true, type: event.type, suppressed: emails.length });
}
