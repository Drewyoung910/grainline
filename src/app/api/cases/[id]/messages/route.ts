// src/app/api/cases/[id]/messages/route.ts
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { sendCaseMessage } from "@/lib/email";
import {
  caseMessageRatelimit,
  rateLimitResponse,
  safeRateLimit,
} from "@/lib/ratelimit";
import {
  unavailableCaseRecipientMessage,
} from "@/lib/caseMessagingState";
import { sanitizeRichText, truncateText } from "@/lib/sanitize";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { EMAIL_APP_URL } from "@/lib/emailBaseUrl";
import { logServerError } from "@/lib/serverErrorLogger";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { requireStaffAdminPinForApi } from "@/lib/adminPinApi";
import {
  MAX_CASE_MESSAGE_ATTACHMENTS,
  verifyPrivateCaseEvidenceForReply,
} from "@/lib/caseEvidence";
import { caseEvidenceAttachmentsEnabled } from "@/lib/caseEvidenceRelease";
import { replyToCaseWithFixedAuthority } from "@/lib/caseReplyAuthority";
import type { CaseReplyResult } from "@/lib/caseReplyResult";
import { getPrismaRawSqlState } from "@/lib/prismaRawSqlError";
import { getCaseMessagePreflight } from "@/lib/caseMessagePreflightAuthority";
import { z } from "zod";

const CaseMessageSchema = z.object({
  body: z.string().min(1).max(5000),
  attachmentKeys: z
    .array(z.string().min(1).max(500))
    .max(MAX_CASE_MESSAGE_ATTACHMENTS)
    .default([]),
});
const CASE_MESSAGE_BODY_MAX_BYTES = 32 * 1024;

export const runtime = "nodejs";

function caseMessageResponse(message: CaseReplyResult, body: string) {
  return {
    id: message.messageId,
    caseId: message.caseId,
    authorId: message.authorUserId,
    authorKind: message.authorKind,
    body,
    createdAt: message.createdAt,
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      contentType: attachment.contentType,
      byteSize: attachment.byteSize,
      createdAt: attachment.createdAt,
    })),
  };
}

function caseReplyFailureResponse(error: unknown) {
  const sqlState = getPrismaRawSqlState(error);
  if (sqlState === null) return null;
  if (sqlState === "22023") {
    return privateJson({ error: "The case reply is invalid." }, { status: 400 });
  }
  if (sqlState === "42501") {
    return privateJson({ error: "Forbidden." }, { status: 403 });
  }
  if (
    sqlState === "23503"
    || sqlState === "23505"
    || sqlState === "23514"
    || sqlState === "40001"
  ) {
    return privateJson(
      { error: "The case or evidence changed. Refresh and try again." },
      { status: 409 },
    );
  }
  return null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
    if (crossOriginRejection) {
      return privateJson({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const { userId, sessionId } = await auth();
    if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

    const { success, reset } = await safeRateLimit(
      caseMessageRatelimit,
      userId,
    );
    if (!success)
      return privateResponse(
        rateLimitResponse(reset, "Too many messages. Slow down and try again."),
      );

    const me = await ensureUserByClerkId(userId);

    let parsed;
    try {
      parsed = CaseMessageSchema.parse(
        await readBoundedJson(req, CASE_MESSAGE_BODY_MAX_BYTES),
      );
    } catch (e) {
      if (isRequestBodyTooLargeError(e)) {
        return privateJson(
          { error: "Request body too large" },
          { status: 413 },
        );
      }
      if (isInvalidJsonBodyError(e)) {
        return privateJson({ error: "Invalid JSON" }, { status: 400 });
      }
      if (e instanceof z.ZodError) {
        return privateJson(
          { error: "Invalid input", details: e.issues },
          { status: 400 },
        );
      }
      throw e;
    }
    const messageBody = sanitizeRichText(parsed.body.trim());
    const attachmentKeys = [...new Set(parsed.attachmentKeys)];
    if (
      attachmentKeys.length > 0
      && !caseEvidenceAttachmentsEnabled()
    ) {
      return privateJson(
        { error: "Case evidence attachments are not available." },
        { status: 400 },
      );
    }
    if (attachmentKeys.length !== parsed.attachmentKeys.length) {
      return privateJson(
        { error: "Duplicate case evidence uploads are not allowed." },
        { status: 400 },
      );
    }
    if (!messageBody)
      return privateJson({ error: "body is required." }, { status: 400 });

    let preflight;
    try {
      preflight = await getCaseMessagePreflight({
        actorUserId: me.id,
        caseId: id,
      });
    } catch (error) {
      if (getPrismaRawSqlState(error) === "22023") {
        return privateJson({ error: "Case not found." }, { status: 404 });
      }
      throw error;
    }
    if (!preflight) {
      return privateJson({ error: "Case not found." }, { status: 404 });
    }

    if (preflight.actsAsStaff) {
      const pinResponse = await requireStaffAdminPinForApi(req, userId, sessionId);
      if (pinResponse) return pinResponse;
    }
    if (!preflight.canCreateMessage) {
      return privateJson({ error: "This case is closed." }, { status: 400 });
    }
    if (preflight.recipientUnavailableReason) {
      return privateJson(
        {
          error: unavailableCaseRecipientMessage(
            preflight.recipientUnavailableReason,
          ),
        },
        { status: 409 },
      );
    }

    const verifiedAttachments: Array<{
      directUploadId: string;
      contentType: string;
      byteSize: number;
    }> = [];
    for (const key of attachmentKeys) {
      const verification = await verifyPrivateCaseEvidenceForReply({
        key,
        clerkUserId: userId,
        accountUserId: me.id,
        caseId: id,
      });
      if (!verification.ok) {
        return privateJson({ error: verification.error }, { status: 400 });
      }
      verifiedAttachments.push(verification.attachment);
    }

    let result;
    try {
      result = await replyToCaseWithFixedAuthority({
        actorUserId: me.id,
        caseId: id,
        body: messageBody,
        verifiedAttachments,
      });
    } catch (error) {
      const response = caseReplyFailureResponse(error);
      if (response) return response;
      throw error;
    }
    const message = caseMessageResponse(result, messageBody);
    if (result.action === "replay") {
      return privateJson(message, { status: 200 });
    }
    const committedCaseRecord = {
      orderId: result.orderId,
      buyerId: result.buyerUserId,
      sellerId: result.sellerUserId,
    };
    const committedActsAsStaff = result.actsAsStaff;

    // Notify the appropriate party/parties
    const senderName =
      me.name ??
      (result.authorUserId === committedCaseRecord.buyerId
        ? "A buyer"
        : result.authorUserId === committedCaseRecord.sellerId
          ? "The seller"
          : "Someone");
    const appUrl = EMAIL_APP_URL;

    if (committedActsAsStaff) {
      // Staff message — notify both buyer and seller
      try {
        const notifications: Promise<unknown>[] = [];
        if (committedCaseRecord.buyerId) {
          notifications.push(
            createNotification({
              userId: committedCaseRecord.buyerId,
              type: "CASE_MESSAGE",
              title: "Grainline Staff sent a message in your case",
              body: truncateText(messageBody, 60),
              link: `/dashboard/orders/${committedCaseRecord.orderId}`,
              relatedUserId: result.authorUserId,
              sourceType: NOTIFICATION_SOURCE_TYPES.CASE_MESSAGE,
              sourceId: message.id,
            }),
          );
        }
        notifications.push(
          createNotification({
            userId: committedCaseRecord.sellerId,
            type: "CASE_MESSAGE",
            title: "Grainline Staff sent a message in your case",
            body: truncateText(messageBody, 60),
            link: `/dashboard/sales/${committedCaseRecord.orderId}`,
            relatedUserId: result.authorUserId,
            sourceType: NOTIFICATION_SOURCE_TYPES.CASE_MESSAGE,
            sourceId: message.id,
          }),
        );
        await Promise.all(notifications);
      } catch (notificationError) {
        Sentry.captureException(notificationError, {
          level: "warning",
          tags: { source: "case_staff_message_notification" },
          extra: {
            caseId: result.caseId,
            orderId: committedCaseRecord.orderId,
            buyerId: committedCaseRecord.buyerId,
            sellerId: committedCaseRecord.sellerId,
          },
        });
      }

      // Send emails to both parties
      try {
        const [buyer, seller] = await Promise.all([
          committedCaseRecord.buyerId
            ? prisma.user.findUnique({
                where: { id: committedCaseRecord.buyerId },
                select: { name: true, email: true },
              })
            : Promise.resolve(null),
          prisma.user.findUnique({
            where: { id: committedCaseRecord.sellerId },
            select: { name: true, email: true },
          }),
        ]);
        if (
          committedCaseRecord.buyerId &&
          buyer?.email &&
          (await shouldSendEmail(
            committedCaseRecord.buyerId,
            "EMAIL_CASE_MESSAGE",
          ))
        ) {
          await sendCaseMessage({
            recipientName: buyer.name,
            recipientEmail: buyer.email,
            senderName: "Grainline Staff",
            caseLink: `${appUrl}/dashboard/orders/${committedCaseRecord.orderId}`,
            messageSnippet: messageBody,
          });
        }
        if (
          seller?.email &&
          (await shouldSendEmail(
            committedCaseRecord.sellerId,
            "EMAIL_CASE_MESSAGE",
          ))
        ) {
          await sendCaseMessage({
            recipientName: seller.name,
            recipientEmail: seller.email,
            senderName: "Grainline Staff",
            caseLink: `${appUrl}/dashboard/sales/${committedCaseRecord.orderId}`,
            messageSnippet: messageBody,
          });
        }
      } catch (emailError) {
        Sentry.captureException(emailError, {
          level: "warning",
          tags: { source: "case_staff_message_email" },
          extra: { caseId: result.caseId, orderId: committedCaseRecord.orderId },
        });
      }
    } else {
      // Buyer or seller message — notify the other party
      const recipientId =
        result.authorUserId === committedCaseRecord.buyerId
          ? committedCaseRecord.sellerId
          : committedCaseRecord.buyerId;
      const caseLink =
        result.authorUserId === committedCaseRecord.buyerId
          ? `/dashboard/sales/${committedCaseRecord.orderId}`
          : `/dashboard/orders/${committedCaseRecord.orderId}`;

      if (recipientId) {
        try {
          await createNotification({
            userId: recipientId,
            type: "CASE_MESSAGE",
            title: `${senderName} sent a message in your case`,
            body: truncateText(messageBody, 60),
            link: caseLink,
            relatedUserId: result.authorUserId,
            sourceType: NOTIFICATION_SOURCE_TYPES.CASE_MESSAGE,
            sourceId: message.id,
          });
        } catch (notificationError) {
          Sentry.captureException(notificationError, {
            level: "warning",
            tags: { source: "case_party_message_notification" },
            extra: {
              caseId: result.caseId,
              orderId: committedCaseRecord.orderId,
              recipientId,
            },
          });
        }

        try {
          if (await shouldSendEmail(recipientId, "EMAIL_CASE_MESSAGE")) {
            const recipient = await prisma.user.findUnique({
              where: { id: recipientId },
              select: { name: true, email: true },
            });
            if (recipient?.email) {
              await sendCaseMessage({
                recipientName: recipient.name,
                recipientEmail: recipient.email,
                senderName: me.name,
                caseLink: `${appUrl}${caseLink}`,
                messageSnippet: messageBody,
              });
            }
          }
        } catch (emailError) {
          Sentry.captureException(emailError, {
            level: "warning",
            tags: { source: "case_party_message_email" },
            extra: {
              caseId: result.caseId,
              orderId: committedCaseRecord.orderId,
              recipientId,
            },
          });
        }
      }
    }

    return privateJson(message, { status: 201 });
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    logServerError(err, { source: "case_message_route" });
    return privateJson({ error: "Server error" }, { status: 500 });
  }
}
