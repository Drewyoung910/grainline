import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { renderCaseUpdateEmail } from "@/lib/email";
import {
  enqueueEmailOutboxOnce,
  processEmailOutboxJobById,
  type QueuedEmail,
} from "@/lib/emailOutbox";
import { processNewlyEnqueuedEmailOutboxJob } from "@/lib/emailOutboxImmediate";
import { userEmailDeliveryRecipient } from "@/lib/userEmailDeliveryAccess";

type CaseTemplate = Extract<QueuedEmail["templateName"], "case_opened" | "case_message" | "case_resolved">;
type CasePreference = "EMAIL_CASE_OPENED" | "EMAIL_CASE_MESSAGE" | "EMAIL_CASE_RESOLVED";

/**
 * Case mail goes through the outbox, so a Resend outage retries it instead of
 * losing the 48-hour notice. A failure here never fails the Case action itself.
 * Pass sendNow: false from a cron batch and let the outbox worker deliver it.
 */
export async function queueCaseEmail({
  email,
  caseId,
  dedupKey,
  templateName,
  userId,
  preferenceKey,
  sendNow = true,
}: {
  email: Pick<QueuedEmail, "to" | "subject" | "html">;
  caseId: string;
  dedupKey: string;
  templateName: CaseTemplate;
  userId: string;
  preferenceKey: CasePreference;
  sendNow?: boolean;
}) {
  try {
    const enqueued = await enqueueEmailOutboxOnce({
      ...email,
      dedupKey,
      templateName,
      userId,
      preferenceKey,
      sourceType: "case",
      sourceId: caseId,
    });
    if (sendNow) await processNewlyEnqueuedEmailOutboxJob(enqueued, processEmailOutboxJobById);
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "case_email", template: templateName },
      extra: { caseId, userId },
    });
  }
}

/** A status change on a Case, told to one participant in plain words. */
export async function sendCaseUpdateEmail({
  caseId,
  orderId,
  userId,
  side,
  dedupKey,
  heading,
  message,
  templateName = "case_message",
  sendNow = true,
}: {
  caseId: string;
  orderId: string;
  userId: string;
  side: "BUYER" | "SELLER";
  dedupKey: string;
  heading: string;
  message: string;
  templateName?: CaseTemplate;
  sendNow?: boolean;
}) {
  const preferenceKey: CasePreference = templateName === "case_opened"
    ? "EMAIL_CASE_OPENED"
    : templateName === "case_resolved"
      ? "EMAIL_CASE_RESOLVED"
      : "EMAIL_CASE_MESSAGE";
  try {
    const recipient = await userEmailDeliveryRecipient(prisma, { userId, preferenceKey });
    if (!recipient) return;
    await queueCaseEmail({
      email: renderCaseUpdateEmail({
        to: recipient.email,
        recipientName: recipient.name,
        orderId,
        side,
        heading,
        message,
      }),
      caseId,
      dedupKey,
      templateName,
      userId,
      preferenceKey,
      sendNow,
    });
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "case_email_recipient" },
      extra: { caseId, userId },
    });
  }
}
