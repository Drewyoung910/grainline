import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { sendRenderedEmail } from "@/lib/email";
import { prisma } from "@/lib/db";
import { sanitizeEmailOutboxError } from "@/lib/emailOutboxSanitize";
import { hashEmailForTelemetry } from "@/lib/privacyTelemetry";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { getIP, rateLimitResponse, safeRateLimit, supportRequestRatelimit } from "@/lib/ratelimit";
import {
  normalizeSupportRequest,
  SUPPORT_REQUEST_EMAIL_PENDING_MARKER,
  supportRequestHtml,
  supportRequestRecipient,
  supportRequestSlaDueAt,
  supportRequestStorageKind,
  supportRequestSubject,
} from "@/lib/supportRequest";
import { currentSupportRequestUserId } from "@/lib/supportRequestAccount";

const SUPPORT_REQUEST_BODY_MAX_BYTES = 24 * 1024;

export async function POST(req: Request) {
  const rate = await safeRateLimit(supportRequestRatelimit, getIP(req));
  if (!rate.success) return rateLimitResponse(rate.reset, "Too many support requests.");

  let body: unknown;
  try {
    body = await readBoundedJson(req, SUPPORT_REQUEST_BODY_MAX_BYTES);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    if (!isInvalidJsonBodyError(error)) throw error;
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const normalized = normalizeSupportRequest("support", body as Record<string, unknown>);
  if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });

  const slaDueAt = supportRequestSlaDueAt();
  const emailHash = hashEmailForTelemetry(normalized.request.email);
  const requesterUserId = await currentSupportRequestUserId();
  let record: { id: string; slaDueAt: Date };
  try {
    record = await prisma.supportRequest.create({
      data: {
        userId: requesterUserId,
        kind: supportRequestStorageKind(normalized.request.kind),
        name: normalized.request.name,
        email: normalized.request.email,
        topic: normalized.request.topic,
        orderId: normalized.request.orderId,
        message: normalized.request.message,
        slaDueAt,
        emailLastError: SUPPORT_REQUEST_EMAIL_PENDING_MARKER,
      },
      select: { id: true, slaDueAt: true },
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "support_request_create" },
      extra: { topic: normalized.request.topic, emailHash },
    });
    return NextResponse.json({ error: "Support request could not be saved. Please email support@thegrainline.com." }, { status: 503 });
  }

  try {
    await sendRenderedEmail({
      to: supportRequestRecipient(normalized.request.kind),
      subject: supportRequestSubject(normalized.request, record.id),
      html: supportRequestHtml(normalized.request, { requestId: record.id, slaDueAt: record.slaDueAt }),
    }, { throwOnFailure: true });
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
      extra: { supportRequestId: record.id, topic: normalized.request.topic, emailHash },
    });
    return NextResponse.json(
      { ok: true, requestId: record.id, slaDueAt: record.slaDueAt.toISOString() },
      { status: 202 },
    );
  }

  try {
    await prisma.supportRequest.update({
      where: { id: record.id },
      data: { emailSentAt: new Date(), emailLastError: null },
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "support_request_email_sent_update" },
      extra: { supportRequestId: record.id, topic: normalized.request.topic, emailHash },
    });
  }

  return NextResponse.json(
    { ok: true, requestId: record.id, slaDueAt: record.slaDueAt.toISOString() },
    { status: 202 },
  );
}
