import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { adminEmailRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { Resend } from "resend";
import { buildUnsubscribeUrl } from "@/lib/unsubscribe";
import { isEmailSuppressed, normalizeEmailAddress } from "@/lib/emailSuppression";
import { createNotification } from "@/lib/notifications";
import { stripBidiControls } from "@/lib/sanitize";

const resend = new Resend(process.env.RESEND_API_KEY);
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://thegrainline.com";

const Schema = z.object({
  userId: z.string().min(1).optional(),
  email: z.string().email().optional(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
}).refine((data) => data.userId || data.email, {
  message: "Either userId or email is required",
});

function safeSubject(subject: string) {
  return stripBidiControls(subject.normalize("NFKC"))
    .replace(/[\r\n]+/g, " ")
    .replace(/[\x00-\x1F\x7F<>"'&]/g, "")
    .trim();
}

function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function POST(request: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = await prisma.user.findUnique({
    where: { clerkId },
    select: { id: true, role: true },
  });
  if (!admin || admin.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden — ADMIN only" }, { status: 403 });
  }

  const rl = await safeRateLimit(adminEmailRatelimit, admin.id);
  if (!rl.success) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  let body;
  try {
    body = Schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  let recipientEmail: string;

  if (body.userId) {
    const recipient = await prisma.user.findUnique({
      where: { id: body.userId },
      select: { email: true, name: true },
    });
    if (!recipient?.email) {
      return NextResponse.json({ error: "User not found or no email" }, { status: 404 });
    }
    recipientEmail = recipient.email;
  } else if (body.email) {
    recipientEmail = body.email;
  } else {
    return NextResponse.json({ error: "Either userId or email is required" }, { status: 400 });
  }

  const normalizedRecipientEmail = normalizeEmailAddress(recipientEmail);
  if (!normalizedRecipientEmail) {
    return NextResponse.json({ error: "Invalid recipient email" }, { status: 400 });
  }
  if (await isEmailSuppressed(normalizedRecipientEmail)) {
    return NextResponse.json({ error: "Recipient email is suppressed after a bounce or complaint" }, { status: 409 });
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn("[admin email] RESEND_API_KEY not set — skipping send");
    return NextResponse.json({ ok: true, skipped: true });
  }

  const escapedBody = body.body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");

  const htmlBody = `
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:600px;margin:0 auto;background:#FAFAF8;padding:0;">
      <div style="background:#1C1C1A;padding:18px 28px;">
        <span style="color:#F2E6D8;font-size:20px;font-weight:bold;letter-spacing:0.05em;">GRAINLINE</span>
      </div>
      <div style="padding:32px 28px;">
        <p style="color:#3D3D3A;font-size:15px;line-height:1.7;margin:0;">${escapedBody}</p>
      </div>
      <div style="padding:16px 28px;border-top:1px solid #E5E2DC;">
        <p style="color:#9CA3AF;font-size:12px;line-height:1.6;margin:0;">This message was sent by the Grainline team · <a href="${APP_URL}" style="color:#9CA3AF;">thegrainline.com</a><br/>Grainline LLC, 5900 Balcones Drive STE 100, Austin, TX 78731</p>
      </div>
    </div>
  `;

  const sanitizedSubject = safeSubject(body.subject);
  const unsubscribeUrl = buildUnsubscribeUrl(normalizedRecipientEmail);

  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM ?? "Grainline <hello@thegrainline.com>",
      to: normalizedRecipientEmail,
      subject: sanitizedSubject,
      html: htmlBody,
      text: htmlToText(htmlBody),
      ...(unsubscribeUrl
        ? {
            headers: {
              "List-Unsubscribe": `<${unsubscribeUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }
        : {}),
    });
  } catch (err) {
    console.error("[admin email] send failed:", err);
    return NextResponse.json({ error: "Email send failed" }, { status: 500 });
  }

  if (body.userId) {
    await createNotification({
      userId: body.userId,
      type: "ACCOUNT_WARNING",
      title: sanitizedSubject,
      body: htmlToText(escapedBody).slice(0, 500) || "Message from the Grainline team.",
      link: "/account",
    }).catch(() => {});
  }

  // Audit log
  try {
    const { logAdminAction } = await import("@/lib/audit");
    await logAdminAction({
      adminId: admin.id,
      action: "SEND_EMAIL",
      targetType: "USER",
      targetId: normalizedRecipientEmail,
      reason: sanitizedSubject,
      metadata: {},
    });
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true });
}
