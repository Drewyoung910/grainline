import * as Sentry from "@sentry/nextjs";
import { sendRenderedEmail } from "@/lib/email";
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
  supportRequestHtml,
  supportRequestRecipient,
  supportRequestSubject,
} from "@/lib/supportRequest";
import {
  recordSupportRequestDelivery,
  submitSupportRequest,
} from "@/lib/supportRequestAccess";
import { currentSupportRequestUserId } from "@/lib/supportRequestAccount";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";

const SUPPORT_REQUEST_BODY_MAX_BYTES = 24 * 1024;

export async function POST(req: Request) {
  const rate = await safeRateLimit(supportRequestRatelimit, getIP(req));
  if (!rate.success) return privateResponse(rateLimitResponse(rate.reset, "Too many support requests."));

  let body: unknown;
  try {
    body = await readBoundedJson(req, SUPPORT_REQUEST_BODY_MAX_BYTES);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return privateJson({ error: "Request body too large" }, { status: HTTP_STATUS.PAYLOAD_TOO_LARGE });
    }
    if (!isInvalidJsonBodyError(error)) throw error;
    return privateJson({ error: "Invalid JSON" }, { status: HTTP_STATUS.BAD_REQUEST });
  }

  const normalized = normalizeSupportRequest(
    "support",
    body as Record<string, unknown> | null | undefined,
  );
  if (!normalized.ok) return privateJson({ error: normalized.error }, { status: HTTP_STATUS.BAD_REQUEST });

  const emailHash = hashEmailForTelemetry(normalized.request.email);
  const requesterUserId = await currentSupportRequestUserId();
  let record: { id: string; slaDueAt: Date; emailDeliveryToken: string };
  try {
    record = await submitSupportRequest(normalized.request, requesterUserId);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "support_request_create" },
      extra: { topic: normalized.request.topic, emailHash },
    });
    return privateJson(
      { error: "Support request could not be saved. Please email support@thegrainline.com." },
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
    await recordSupportRequestDelivery({
      requestId: record.id,
      deliveryToken: record.emailDeliveryToken,
      sent: false,
      error: emailLastError,
    }).then((applied) => {
      if (!applied) throw new Error("Support request delivery capability was already consumed");
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
    return privateJson(
      { ok: true, requestId: record.id, slaDueAt: record.slaDueAt.toISOString() },
      { status: HTTP_STATUS.ACCEPTED },
    );
  }

  try {
    const applied = await recordSupportRequestDelivery({
      requestId: record.id,
      deliveryToken: record.emailDeliveryToken,
      sent: true,
      error: null,
    });
    if (!applied) throw new Error("Support request delivery capability was already consumed");
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "support_request_email_sent_update" },
      extra: { supportRequestId: record.id, topic: normalized.request.topic, emailHash },
    });
  }

  return privateJson(
    { ok: true, requestId: record.id, slaDueAt: record.slaDueAt.toISOString() },
    { status: HTTP_STATUS.ACCEPTED },
  );
}
