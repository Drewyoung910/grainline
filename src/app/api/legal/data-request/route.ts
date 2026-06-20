import * as Sentry from "@sentry/nextjs";
import { sendRenderedEmail } from "@/lib/email";
import { prisma } from "@/lib/db";
import { sanitizeEmailOutboxError } from "@/lib/emailOutboxSanitize";
import { hashEmailForTelemetry } from "@/lib/privacyTelemetry";
import { dataRequestRatelimit, getIP, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
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
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";

const DATA_REQUEST_BODY_MAX_BYTES = 24 * 1024;

export async function POST(req: Request) {
  const rate = await safeRateLimit(dataRequestRatelimit, getIP(req));
  if (!rate.success) return privateResponse(rateLimitResponse(rate.reset, "Too many data requests."));

  let body: unknown;
  try {
    body = await readBoundedJson(req, DATA_REQUEST_BODY_MAX_BYTES);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return privateJson({ error: "Request body too large" }, { status: HTTP_STATUS.PAYLOAD_TOO_LARGE });
    }
    if (!isInvalidJsonBodyError(error)) throw error;
    return privateJson({ error: "Invalid JSON" }, { status: HTTP_STATUS.BAD_REQUEST });
  }

  const normalized = normalizeSupportRequest("data_request", body as Record<string, unknown>);
  if (!normalized.ok) return privateJson({ error: normalized.error }, { status: HTTP_STATUS.BAD_REQUEST });

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
        listingId: normalized.request.listingId,
        message: normalized.request.message,
        slaDueAt,
        emailLastError: SUPPORT_REQUEST_EMAIL_PENDING_MARKER,
      },
      select: { id: true, slaDueAt: true },
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "data_request_create" },
      extra: { topic: normalized.request.topic, emailHash },
    });
    return privateJson(
      { error: "Data request could not be saved. Please email legal@thegrainline.com." },
      { status: HTTP_STATUS.SERVICE_UNAVAILABLE },
    );
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
        tags: { source: "data_request_email_error_update" },
        extra: { supportRequestId: record.id },
      });
    });
    Sentry.captureException(error, {
      tags: { source: "data_request" },
      extra: { supportRequestId: record.id, topic: normalized.request.topic, emailHash },
    });
    return privateJson(
      { ok: true, requestId: record.id, slaDueAt: record.slaDueAt.toISOString() },
      { status: HTTP_STATUS.ACCEPTED },
    );
  }

  try {
    await prisma.supportRequest.update({
      where: { id: record.id },
      data: { emailSentAt: new Date(), emailLastError: null },
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "data_request_email_sent_update" },
      extra: { supportRequestId: record.id, topic: normalized.request.topic, emailHash },
    });
  }

  return privateJson(
    { ok: true, requestId: record.id, slaDueAt: record.slaDueAt.toISOString() },
    { status: HTTP_STATUS.ACCEPTED },
  );
}
