import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { sendRenderedEmail } from "@/lib/email";
import { prisma } from "@/lib/db";
import { sanitizeEmailOutboxError } from "@/lib/emailOutboxSanitize";
import { getIP, rateLimitResponse, safeRateLimitOpen, supportRequestRatelimit } from "@/lib/ratelimit";
import {
  normalizeSupportRequest,
  supportRequestHtml,
  supportRequestRecipient,
  supportRequestSlaDueAt,
  supportRequestStorageKind,
  supportRequestSubject,
} from "@/lib/supportRequest";

export async function POST(req: Request) {
  const rate = await safeRateLimitOpen(supportRequestRatelimit, getIP(req));
  if (!rate.success) return rateLimitResponse(rate.reset, "Too many support requests.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const normalized = normalizeSupportRequest("support", body as Record<string, unknown>);
  if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });

  const slaDueAt = supportRequestSlaDueAt();
  let record: { id: string; slaDueAt: Date };
  try {
    record = await prisma.supportRequest.create({
      data: {
        kind: supportRequestStorageKind(normalized.request.kind),
        name: normalized.request.name,
        email: normalized.request.email,
        topic: normalized.request.topic,
        orderId: normalized.request.orderId,
        message: normalized.request.message,
        slaDueAt,
      },
      select: { id: true, slaDueAt: true },
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "support_request_create" },
      extra: { topic: normalized.request.topic, email: normalized.request.email },
    });
    return NextResponse.json({ error: "Support request could not be saved. Please email support@thegrainline.com." }, { status: 503 });
  }

  try {
    await sendRenderedEmail({
      to: supportRequestRecipient(normalized.request.kind),
      subject: supportRequestSubject(normalized.request, record.id),
      html: supportRequestHtml(normalized.request, { requestId: record.id, slaDueAt: record.slaDueAt }),
    }, { throwOnFailure: true });
    await prisma.supportRequest.update({
      where: { id: record.id },
      data: { emailSentAt: new Date(), emailLastError: null },
    });
  } catch (error) {
    const emailLastError = sanitizeEmailOutboxError(error);
    await prisma.supportRequest.update({
      where: { id: record.id },
      data: { emailLastError },
    }).catch((updateError) => {
      Sentry.captureException(updateError, {
        tags: { source: "support_request_email_error_update" },
        extra: { supportRequestId: record.id },
      });
    });
    Sentry.captureException(error, {
      tags: { source: "support_request" },
      extra: { supportRequestId: record.id, topic: normalized.request.topic, email: normalized.request.email },
    });
  }

  return NextResponse.json(
    { ok: true, requestId: record.id, slaDueAt: record.slaDueAt.toISOString() },
    { status: 202 },
  );
}
