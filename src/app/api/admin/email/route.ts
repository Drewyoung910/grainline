import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { adminEmailRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { isEmailSuppressed, normalizeEmailAddress } from "@/lib/emailSuppression";
import { createNotification } from "@/lib/notifications";
import { normalizeUserText, stripBidiControls, truncateText } from "@/lib/sanitize";
import { sendRenderedEmail, UNSUBSCRIBE_HREF_PLACEHOLDER } from "@/lib/email";
import { sanitizeEmailOutboxError } from "@/lib/emailOutboxSanitize";
import { inactiveAdminEmailRecipientReason } from "@/lib/adminEmailRecipient";
import { logAdminAction } from "@/lib/audit";
import { hashEmailForTelemetry } from "@/lib/privacyTelemetry";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { EMAIL_APP_URL } from "@/lib/emailBaseUrl";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";

const APP_URL = EMAIL_APP_URL;
const ADMIN_EMAIL_BODY_MAX_BYTES = 64 * 1024;

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

export async function POST(request: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

  const admin = await prisma.user.findUnique({
    where: { clerkId },
    select: { id: true, role: true, banned: true, deletedAt: true },
  });
  if (!admin || admin.banned || admin.deletedAt || admin.role !== "ADMIN") {
    return privateJson({ error: "Forbidden — ADMIN only" }, { status: HTTP_STATUS.FORBIDDEN });
  }

  const rl = await safeRateLimit(adminEmailRatelimit, admin.id);
  if (!rl.success) return privateResponse(rateLimitResponse(rl.reset, "Too many admin email attempts."));

  let body;
  try {
    body = Schema.parse(await readBoundedJson(request, ADMIN_EMAIL_BODY_MAX_BYTES));
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return privateJson({ error: "Request body too large" }, { status: HTTP_STATUS.PAYLOAD_TOO_LARGE });
    }
    if (isInvalidJsonBodyError(error) || error instanceof z.ZodError) {
      return privateJson({ error: "Invalid input" }, { status: HTTP_STATUS.BAD_REQUEST });
    }
    throw error;
  }

  let recipientEmail: string;
  let recipientUserId: string | null = body.userId ?? null;

  if (body.userId) {
    const recipient = await prisma.user.findUnique({
      where: { id: body.userId },
      select: { email: true, name: true, banned: true, deletedAt: true },
    });
    if (!recipient?.email) {
      return privateJson({ error: "User not found or no email" }, { status: HTTP_STATUS.NOT_FOUND });
    }
    const inactiveReason = inactiveAdminEmailRecipientReason(recipient);
    if (inactiveReason) {
      return privateJson({ error: inactiveReason }, { status: HTTP_STATUS.CONFLICT });
    }
    recipientEmail = recipient.email;
  } else if (body.email) {
    const normalizedInputEmail = normalizeEmailAddress(body.email);
    if (!normalizedInputEmail) {
      return privateJson({ error: "Invalid recipient email" }, { status: HTTP_STATUS.BAD_REQUEST });
    }
    const recipient = await prisma.user.findUnique({
      where: { email: normalizedInputEmail },
      select: { id: true, email: true, name: true, banned: true, deletedAt: true },
    });
    if (!recipient?.email) {
      return privateJson(
        { error: "Admin email can only be sent to an existing Grainline user." },
        { status: HTTP_STATUS.NOT_FOUND },
      );
    }
    const inactiveReason = inactiveAdminEmailRecipientReason(recipient);
    if (inactiveReason) {
      return privateJson({ error: inactiveReason }, { status: HTTP_STATUS.CONFLICT });
    }
    recipientEmail = recipient.email;
    recipientUserId = recipient.id;
  } else {
    return privateJson({ error: "Either userId or email is required" }, { status: HTTP_STATUS.BAD_REQUEST });
  }

  const normalizedRecipientEmail = normalizeEmailAddress(recipientEmail);
  if (!normalizedRecipientEmail) {
    return privateJson({ error: "Invalid recipient email" }, { status: HTTP_STATUS.BAD_REQUEST });
  }
  if (await isEmailSuppressed(normalizedRecipientEmail)) {
    return privateJson({ error: "Recipient email is suppressed or unsubscribed" }, { status: HTTP_STATUS.CONFLICT });
  }

  const recipientAccount = await prisma.user.findUnique({
    where: { email: normalizedRecipientEmail },
    select: { banned: true, deletedAt: true },
  });
  const inactiveReason = inactiveAdminEmailRecipientReason(recipientAccount);
  if (inactiveReason) {
    return privateJson({ error: inactiveReason }, { status: HTTP_STATUS.CONFLICT });
  }

  const sanitizedBody = normalizeUserText(body.body);
  const escapedBody = sanitizedBody
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
        <p style="color:#9CA3AF;font-size:12px;line-height:1.6;margin:0;">This message was sent by the Grainline team · <a href="${APP_URL}" style="color:#9CA3AF;">thegrainline.com</a> · <a href="${UNSUBSCRIBE_HREF_PLACEHOLDER}" style="color:#9CA3AF;">Unsubscribe</a> · <a href="mailto:support@thegrainline.com" style="color:#9CA3AF;">support@thegrainline.com</a><br/>Grainline LLC, 5900 Balcones Drive STE 100, Austin, TX 78731</p>
      </div>
    </div>
  `;

  const sanitizedSubject = safeSubject(body.subject);
  const emailConfigured = !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;

  try {
    await sendRenderedEmail({
      to: normalizedRecipientEmail,
      subject: sanitizedSubject,
      html: htmlBody,
    }, { throwOnFailure: true });
  } catch (err) {
    console.error("[admin email] send failed:", sanitizeEmailOutboxError(err));
    Sentry.captureException(err, {
      level: "warning",
      tags: { source: "admin_email_send" },
      extra: { targetUserId: recipientUserId, emailHash: hashEmailForTelemetry(normalizedRecipientEmail) },
    });
    return privateJson({ error: "Email send failed" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }

  if (recipientUserId) {
    await createNotification({
      userId: recipientUserId,
      type: "ACCOUNT_WARNING",
      title: sanitizedSubject,
      body: truncateText(sanitizedBody.replace(/\s+/g, " ").trim(), 500) || "Message from the Grainline team.",
      link: "/account",
    }).catch((error) => {
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "admin_email_notification" },
        extra: { targetUserId: recipientUserId },
      });
    });
  }

  // Audit log
  try {
    const auditTargetId = recipientUserId ?? `email:${hashEmailForTelemetry(normalizedRecipientEmail) ?? "unknown"}`;
    await logAdminAction({
      adminId: admin.id,
      action: "SEND_EMAIL",
      targetType: recipientUserId ? "USER" : "EMAIL",
      targetId: auditTargetId,
      reason: sanitizedSubject,
      metadata: {},
    });
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "admin_email_audit_log" },
      extra: { targetUserId: recipientUserId, emailHash: hashEmailForTelemetry(normalizedRecipientEmail) },
    });
  }

  return privateJson({ ok: true, skipped: !emailConfigured });
}
