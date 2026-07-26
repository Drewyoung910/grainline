// src/app/api/cases/[id]/messages/route.ts
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { createHash } from "crypto";
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
  canCreateCaseMessageForStatus,
  caseMessageStatusTransition,
  unavailableCaseMessageRecipientReason,
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
import { caseMessageAuthorKindForActor } from "@/lib/caseMessageAuthor";
import {
  CASE_EVIDENCE_STORAGE_CLASS,
  CASE_EVIDENCE_UPLOAD_ENDPOINT,
  MAX_CASE_MESSAGE_ATTACHMENTS,
  verifyPrivateCaseEvidenceForPersistence,
} from "@/lib/caseEvidence";
import {
  claimDirectUploadForKey,
  DirectUploadClaimError,
} from "@/lib/directUploadLifecycle";
import { DIRECT_UPLOAD_STATUS } from "@/lib/directUploadLifecycleState";
import { z } from "zod";

const CaseMessageSchema = z.object({
  body: z.string().min(1).max(5000),
  attachmentKeys: z
    .array(z.string().min(1).max(500))
    .max(MAX_CASE_MESSAGE_ATTACHMENTS)
    .default([]),
});
const CASE_MESSAGE_BODY_MAX_BYTES = 32 * 1024;
const CASE_MESSAGE_DEDUP_WINDOW_MS = 30_000;

export const runtime = "nodejs";

function attachmentKeysMatch(
  attachments: readonly { objectKey: string }[],
  expectedKeys: readonly string[],
) {
  if (attachments.length !== expectedKeys.length) return false;
  const actual = attachments.map(({ objectKey }) => objectKey).sort();
  const expected = [...expectedKeys].sort();
  return actual.every((key, index) => key === expected[index]);
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
    if (attachmentKeys.length !== parsed.attachmentKeys.length) {
      return privateJson(
        { error: "Duplicate case evidence uploads are not allowed." },
        { status: 400 },
      );
    }
    if (!messageBody)
      return privateJson({ error: "body is required." }, { status: 400 });

    const caseRecord = await prisma.case.findUnique({
      where: { id },
      include: {
        buyer: { select: { id: true, banned: true, deletedAt: true } },
        seller: { select: { id: true, banned: true, deletedAt: true } },
      },
    });
    if (!caseRecord)
      return privateJson({ error: "Case not found." }, { status: 404 });

    const isParty =
      me.id === caseRecord.buyerId || me.id === caseRecord.sellerId;
    const isStaff = me.role === "EMPLOYEE" || me.role === "ADMIN";
    if (!isParty && !isStaff)
      return privateJson({ error: "Forbidden." }, { status: 403 });
    if (!isParty && isStaff) {
      const pinResponse = await requireStaffAdminPinForApi(req, userId, sessionId);
      if (pinResponse) return pinResponse;
    }

    const now = new Date();
    const duplicateCutoff = new Date(
      now.getTime() - CASE_MESSAGE_DEDUP_WINDOW_MS,
    );
    if (attachmentKeys.length > 0) {
      const claimedRetryCandidates = await prisma.caseMessage.findMany({
        where: {
          caseId: id,
          authorId: me.id,
          body: messageBody,
          createdAt: { gte: duplicateCutoff },
          attachments: {
            some: { objectKey: { in: attachmentKeys } },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 5,
        include: {
          attachments: {
            select: { objectKey: true },
          },
        },
      });
      const claimedRetry = claimedRetryCandidates.find((candidate) =>
        attachmentKeysMatch(candidate.attachments, attachmentKeys),
      );
      if (claimedRetry) {
        return privateJson(claimedRetry, { status: 200 });
      }
    }

    if (!canCreateCaseMessageForStatus(caseRecord.status, { isStaff })) {
      return privateJson({ error: "This case is closed." }, { status: 400 });
    }

    const unavailableRecipientReason = unavailableCaseMessageRecipientReason({
      senderId: me.id,
      buyer: caseRecord.buyer,
      seller: caseRecord.seller,
      isStaff,
    });
    if (unavailableRecipientReason) {
      return privateJson(
        { error: unavailableCaseRecipientMessage(unavailableRecipientReason) },
        { status: 409 },
      );
    }

    const authorKind = caseMessageAuthorKindForActor({
      actorId: me.id,
      buyerId: caseRecord.buyerId,
      sellerId: caseRecord.sellerId,
      isStaff,
    });
    const verifiedAttachments: Array<{
      objectKey: string;
      contentType: string;
      byteSize: number;
    }> = [];
    for (const key of attachmentKeys) {
      const verification = await verifyPrivateCaseEvidenceForPersistence({
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

    const caseUpdates: Record<string, unknown> = { updatedAt: now };
    const statusTransition = caseMessageStatusTransition({
      status: caseRecord.status,
      actorId: me.id,
      buyerId: caseRecord.buyerId,
      sellerId: caseRecord.sellerId,
      isStaff,
    });

    // When seller responds to an OPEN case for the first time, transition to IN_DISCUSSION.
    // If a party continues a pending-close case, clear prior resolution flags so
    // the case cannot close on stale consent.
    if (statusTransition === "seller_started_discussion") {
      caseUpdates.status = "IN_DISCUSSION";
      caseUpdates.discussionStartedAt = now;
      caseUpdates.escalateUnlocksAt = new Date(
        now.getTime() + 48 * 60 * 60 * 1000,
      );
    } else if (statusTransition === "party_reopened_pending_close") {
      caseUpdates.status = "IN_DISCUSSION";
      caseUpdates.buyerMarkedResolved = false;
      caseUpdates.sellerMarkedResolved = false;
    }

    const duplicateKey = createHash("sha256")
      .update(`${id}:${me.id}:${messageBody}:${[...attachmentKeys].sort().join(",")}`)
      .digest("hex");

    const messageResult = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`case-message:${duplicateKey}`})::bigint)`;

      const duplicateCandidates = await tx.caseMessage.findMany({
        where: {
          caseId: id,
          authorId: me.id,
          body: messageBody,
          createdAt: { gte: duplicateCutoff },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 5,
        include: {
          attachments: {
            select: { objectKey: true },
          },
        },
      });
      const duplicate = duplicateCandidates.find((candidate) =>
        attachmentKeysMatch(candidate.attachments, attachmentKeys),
      );
      if (duplicate) return { message: duplicate, duplicate: true as const };

      const updated = await tx.case.updateMany({
        where: { id, status: caseRecord.status },
        data: caseUpdates,
      });
      if (updated.count === 0) {
        const statusRaceCandidates = await tx.caseMessage.findMany({
          where: {
            caseId: id,
            authorId: me.id,
            body: messageBody,
            createdAt: { gte: duplicateCutoff },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 5,
          include: {
            attachments: {
              select: { objectKey: true },
            },
          },
        });
        const statusRaceDuplicate = statusRaceCandidates.find((candidate) =>
          attachmentKeysMatch(candidate.attachments, attachmentKeys),
        );
        if (statusRaceDuplicate)
          return { message: statusRaceDuplicate, duplicate: true as const };
        throw new Error("CASE_STATUS_CHANGED");
      }

      for (const attachment of verifiedAttachments) {
        const claimed = await claimDirectUploadForKey({
          client: tx,
          key: attachment.objectKey,
          userId: me.id,
          endpoint: CASE_EVIDENCE_UPLOAD_ENDPOINT,
          storageClass: CASE_EVIDENCE_STORAGE_CLASS,
          claimedByType: "CASE_MESSAGE_ATTACHMENT",
          now,
        });
        if (!claimed.tracked || !claimed.claimed) {
          throw new DirectUploadClaimError();
        }
      }

      const message = await tx.caseMessage.create({
        data: {
          caseId: id,
          authorId: me.id,
          authorKind,
          body: messageBody,
          attachments: {
            create: verifiedAttachments.map((attachment) => ({
              uploaderId: me.id,
              objectKey: attachment.objectKey,
              contentType: attachment.contentType,
              byteSize: attachment.byteSize,
            })),
          },
        },
        include: {
          attachments: {
            select: {
              id: true,
              objectKey: true,
              contentType: true,
              byteSize: true,
              createdAt: true,
            },
          },
        },
      });

      for (const attachment of message.attachments) {
        const linked = await tx.directUpload.updateMany({
          where: {
            key: attachment.objectKey,
            status: DIRECT_UPLOAD_STATUS.CLAIMED,
            claimedByType: "CASE_MESSAGE_ATTACHMENT",
            claimedById: null,
          },
          data: { claimedById: attachment.id },
        });
        if (linked.count !== 1) {
          throw new DirectUploadClaimError();
        }
      }
      return { message, duplicate: false as const };
    });
    if (messageResult.duplicate) {
      return privateJson(messageResult.message, { status: 200 });
    }
    const message = messageResult.message;

    // Notify the appropriate party/parties
    const senderName =
      me.name ??
      (me.id === caseRecord.buyerId
        ? "A buyer"
        : me.id === caseRecord.sellerId
          ? "The seller"
          : "Someone");
    const appUrl = EMAIL_APP_URL;

    if (isStaff && !isParty) {
      // Staff message — notify both buyer and seller
      try {
        const notifications: Promise<unknown>[] = [];
        if (caseRecord.buyerId) {
          notifications.push(
            createNotification({
              userId: caseRecord.buyerId,
              type: "CASE_MESSAGE",
              title: "Grainline Staff sent a message in your case",
              body: truncateText(messageBody, 60),
              link: `/dashboard/orders/${caseRecord.orderId}`,
              relatedUserId: me.id,
              sourceType: NOTIFICATION_SOURCE_TYPES.CASE_MESSAGE,
              sourceId: message.id,
            }),
          );
        }
        notifications.push(
          createNotification({
            userId: caseRecord.sellerId,
            type: "CASE_MESSAGE",
            title: "Grainline Staff sent a message in your case",
            body: truncateText(messageBody, 60),
            link: `/dashboard/sales/${caseRecord.orderId}`,
            relatedUserId: me.id,
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
            caseId: id,
            orderId: caseRecord.orderId,
            buyerId: caseRecord.buyerId,
            sellerId: caseRecord.sellerId,
          },
        });
      }

      // Send emails to both parties
      try {
        const [buyer, seller] = await Promise.all([
          caseRecord.buyerId
            ? prisma.user.findUnique({
                where: { id: caseRecord.buyerId },
                select: { name: true, email: true },
              })
            : Promise.resolve(null),
          prisma.user.findUnique({
            where: { id: caseRecord.sellerId },
            select: { name: true, email: true },
          }),
        ]);
        if (
          caseRecord.buyerId &&
          buyer?.email &&
          (await shouldSendEmail(caseRecord.buyerId, "EMAIL_CASE_MESSAGE"))
        ) {
          await sendCaseMessage({
            recipientName: buyer.name,
            recipientEmail: buyer.email,
            senderName: "Grainline Staff",
            caseLink: `${appUrl}/dashboard/orders/${caseRecord.orderId}`,
            messageSnippet: messageBody,
          });
        }
        if (
          seller?.email &&
          (await shouldSendEmail(caseRecord.sellerId, "EMAIL_CASE_MESSAGE"))
        ) {
          await sendCaseMessage({
            recipientName: seller.name,
            recipientEmail: seller.email,
            senderName: "Grainline Staff",
            caseLink: `${appUrl}/dashboard/sales/${caseRecord.orderId}`,
            messageSnippet: messageBody,
          });
        }
      } catch (emailError) {
        Sentry.captureException(emailError, {
          level: "warning",
          tags: { source: "case_staff_message_email" },
          extra: { caseId: id, orderId: caseRecord.orderId },
        });
      }
    } else {
      // Buyer or seller message — notify the other party
      const recipientId =
        me.id === caseRecord.buyerId ? caseRecord.sellerId : caseRecord.buyerId;
      const caseLink =
        me.id === caseRecord.buyerId
          ? `/dashboard/sales/${caseRecord.orderId}`
          : `/dashboard/orders/${caseRecord.orderId}`;

      if (recipientId) {
        try {
          await createNotification({
            userId: recipientId,
            type: "CASE_MESSAGE",
            title: `${senderName} sent a message in your case`,
            body: truncateText(messageBody, 60),
            link: caseLink,
            relatedUserId: me.id,
            sourceType: NOTIFICATION_SOURCE_TYPES.CASE_MESSAGE,
            sourceId: message.id,
          });
        } catch (notificationError) {
          Sentry.captureException(notificationError, {
            level: "warning",
            tags: { source: "case_party_message_notification" },
            extra: { caseId: id, orderId: caseRecord.orderId, recipientId },
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
            extra: { caseId: id, orderId: caseRecord.orderId, recipientId },
          });
        }
      }
    }

    return privateJson(message, { status: 201 });
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    if (err instanceof DirectUploadClaimError) {
      return privateJson({ error: err.message }, { status: 409 });
    }
    if (err instanceof Error && err.message === "CASE_STATUS_CHANGED") {
      return privateJson(
        {
          error:
            "Case status changed before your message could be saved. Refresh and try again.",
        },
        { status: 409 },
      );
    }

    logServerError(err, { source: "case_message_route" });
    return privateJson({ error: "Server error" }, { status: 500 });
  }
}
