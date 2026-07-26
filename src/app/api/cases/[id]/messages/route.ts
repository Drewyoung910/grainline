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
import {
  databaseClockTimestamp,
  lockCaseForLifecycle,
} from "@/lib/caseLifecycleLocks";
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

class CaseMessageRouteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CaseMessageRouteError";
  }
}

function attachmentKeysMatch(
  attachments: readonly { objectKey: string }[],
  expectedKeys: readonly string[],
) {
  if (attachments.length !== expectedKeys.length) return false;
  const actual = attachments.map(({ objectKey }) => objectKey).sort();
  const expected = [...expectedKeys].sort();
  return actual.every((key, index) => key === expected[index]);
}

type CaseMessageResponseAttachment = {
  id: string;
  objectKey: string;
  contentType: string;
  byteSize: number;
  createdAt: Date;
};

function caseMessageResponse<
  T extends { attachments: readonly CaseMessageResponseAttachment[] },
>(message: T): Omit<T, "attachments"> & {
  attachments: Array<Omit<CaseMessageResponseAttachment, "objectKey">>;
} {
  const { attachments, ...messageFields } = message;
  return {
    ...messageFields,
    attachments: attachments.map((attachment) => ({
      id: attachment.id,
      contentType: attachment.contentType,
      byteSize: attachment.byteSize,
      createdAt: attachment.createdAt,
    })),
  };
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
    const isNonPartyStaff = isStaff && !isParty;
    if (!isParty && !isStaff)
      return privateJson({ error: "Forbidden." }, { status: 403 });
    if (isNonPartyStaff) {
      const pinResponse = await requireStaffAdminPinForApi(req, userId, sessionId);
      if (pinResponse) return pinResponse;
    }
    const nonPartyStaffPinVerified = isNonPartyStaff;

    const retryCutoff = new Date(
      Date.now() - CASE_MESSAGE_DEDUP_WINDOW_MS,
    );
    if (attachmentKeys.length > 0) {
      const claimedRetryCandidates = await prisma.caseMessage.findMany({
        where: {
          caseId: id,
          authorId: me.id,
          body: messageBody,
          createdAt: { gte: retryCutoff },
          attachments: {
            some: { objectKey: { in: attachmentKeys } },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 5,
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
      const claimedRetry = claimedRetryCandidates.find((candidate) =>
        attachmentKeysMatch(candidate.attachments, attachmentKeys),
      );
      if (claimedRetry) {
        return privateJson(caseMessageResponse(claimedRetry), { status: 200 });
      }
    }

    if (
      !canCreateCaseMessageForStatus(caseRecord.status, {
        isStaff: isNonPartyStaff,
      })
    ) {
      return privateJson({ error: "This case is closed." }, { status: 400 });
    }

    const unavailableRecipientReason = unavailableCaseMessageRecipientReason({
      senderId: me.id,
      buyer: caseRecord.buyer,
      seller: caseRecord.seller,
      isStaff: isNonPartyStaff,
    });
    if (unavailableRecipientReason) {
      return privateJson(
        { error: unavailableCaseRecipientMessage(unavailableRecipientReason) },
        { status: 409 },
      );
    }

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

    const duplicateKey = createHash("sha256")
      .update(`${id}:${me.id}:${messageBody}:${[...attachmentKeys].sort().join(",")}`)
      .digest("hex");

    const messageResult = await prisma.$transaction(async (tx) => {
      const caseExists = await lockCaseForLifecycle(tx, id);
      if (!caseExists) {
        throw new CaseMessageRouteError("Case not found.", 404);
      }
      const lockedCase = await tx.case.findUnique({
        where: { id },
        include: {
          buyer: { select: { id: true, banned: true, deletedAt: true } },
          seller: { select: { id: true, banned: true, deletedAt: true } },
        },
      });
      if (!lockedCase) {
        throw new CaseMessageRouteError("Case not found.", 404);
      }
      const lockedActor = await tx.user.findUnique({
        where: { id: me.id },
        select: { id: true, role: true, banned: true, deletedAt: true },
      });
      if (!lockedActor || lockedActor.banned || lockedActor.deletedAt) {
        throw new CaseMessageRouteError(
          "Your account cannot send case messages.",
          403,
        );
      }

      const lockedIsParty =
        lockedActor.id === lockedCase.buyerId ||
        lockedActor.id === lockedCase.sellerId;
      const lockedIsStaff =
        lockedActor.role === "EMPLOYEE" || lockedActor.role === "ADMIN";
      const lockedActsAsStaff = lockedIsStaff && !lockedIsParty;
      if (!lockedIsParty && !lockedIsStaff) {
        throw new CaseMessageRouteError("Forbidden.", 403);
      }
      if (lockedActsAsStaff && !nonPartyStaffPinVerified) {
        throw new CaseMessageRouteError("Admin PIN required.", 403);
      }
      if (
        !canCreateCaseMessageForStatus(lockedCase.status, {
          isStaff: lockedActsAsStaff,
        })
      ) {
        throw new CaseMessageRouteError("This case is closed.", 400);
      }
      const lockedUnavailableReason = unavailableCaseMessageRecipientReason({
        senderId: lockedActor.id,
        buyer: lockedCase.buyer,
        seller: lockedCase.seller,
        isStaff: lockedActsAsStaff,
      });
      if (lockedUnavailableReason) {
        throw new CaseMessageRouteError(
          unavailableCaseRecipientMessage(lockedUnavailableReason),
          409,
        );
      }

      const transitionAt = await databaseClockTimestamp(tx);
      const duplicateCutoff = new Date(
        transitionAt.getTime() - CASE_MESSAGE_DEDUP_WINDOW_MS,
      );
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`case-message:${duplicateKey}`})::bigint)`;

      const duplicateCandidates = await tx.caseMessage.findMany({
        where: {
          caseId: id,
          authorId: lockedActor.id,
          body: messageBody,
          createdAt: { gte: duplicateCutoff },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 5,
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
      const duplicate = duplicateCandidates.find((candidate) =>
        attachmentKeysMatch(candidate.attachments, attachmentKeys),
      );
      if (duplicate) {
        return {
          caseRecord: lockedCase,
          isStaff: lockedActsAsStaff,
          message: duplicate,
          duplicate: true as const,
        };
      }

      const statusTransition = caseMessageStatusTransition({
        status: lockedCase.status,
        actorId: lockedActor.id,
        buyerId: lockedCase.buyerId,
        sellerId: lockedCase.sellerId,
        isStaff: lockedActsAsStaff,
      });
      const caseUpdates =
        statusTransition === "seller_started_discussion"
          ? {
              status: "IN_DISCUSSION" as const,
              discussionStartedAt: transitionAt,
              escalateUnlocksAt: new Date(
                transitionAt.getTime() + 48 * 60 * 60 * 1000,
              ),
              updatedAt: transitionAt,
            }
          : statusTransition === "party_reopened_pending_close"
            ? {
                status: "IN_DISCUSSION" as const,
                buyerMarkedResolved: false,
                sellerMarkedResolved: false,
                updatedAt: transitionAt,
              }
            : { updatedAt: transitionAt };
      await tx.case.update({
        where: { id },
        data: caseUpdates,
      });

      for (const attachment of verifiedAttachments) {
        const claimed = await claimDirectUploadForKey({
          client: tx,
          key: attachment.objectKey,
          userId: lockedActor.id,
          endpoint: CASE_EVIDENCE_UPLOAD_ENDPOINT,
          storageClass: CASE_EVIDENCE_STORAGE_CLASS,
          claimedByType: "CASE_MESSAGE_ATTACHMENT",
          now: transitionAt,
        });
        if (!claimed.tracked || !claimed.claimed) {
          throw new DirectUploadClaimError();
        }
      }

      const authorKind = caseMessageAuthorKindForActor({
        actorId: lockedActor.id,
        buyerId: lockedCase.buyerId,
        sellerId: lockedCase.sellerId,
        isStaff: lockedIsStaff,
      });
      const message = await tx.caseMessage.create({
        data: {
          caseId: id,
          authorId: lockedActor.id,
          authorKind,
          body: messageBody,
          createdAt: transitionAt,
          attachments: {
            create: verifiedAttachments.map((attachment) => ({
              uploaderId: lockedActor.id,
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
      return {
        caseRecord: lockedCase,
        isStaff: lockedActsAsStaff,
        message,
        duplicate: false as const,
      };
    });
    if (messageResult.duplicate) {
      return privateJson(caseMessageResponse(messageResult.message), {
        status: 200,
      });
    }
    const message = messageResult.message;
    const committedCaseRecord = messageResult.caseRecord;
    const committedActsAsStaff = messageResult.isStaff;

    // Notify the appropriate party/parties
    const senderName =
      me.name ??
      (me.id === committedCaseRecord.buyerId
        ? "A buyer"
        : me.id === committedCaseRecord.sellerId
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
              relatedUserId: me.id,
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
          extra: { caseId: id, orderId: committedCaseRecord.orderId },
        });
      }
    } else {
      // Buyer or seller message — notify the other party
      const recipientId =
        me.id === committedCaseRecord.buyerId
          ? committedCaseRecord.sellerId
          : committedCaseRecord.buyerId;
      const caseLink =
        me.id === committedCaseRecord.buyerId
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
            relatedUserId: me.id,
            sourceType: NOTIFICATION_SOURCE_TYPES.CASE_MESSAGE,
            sourceId: message.id,
          });
        } catch (notificationError) {
          Sentry.captureException(notificationError, {
            level: "warning",
            tags: { source: "case_party_message_notification" },
            extra: {
              caseId: id,
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
              caseId: id,
              orderId: committedCaseRecord.orderId,
              recipientId,
            },
          });
        }
      }
    }

    return privateJson(caseMessageResponse(message), { status: 201 });
  } catch (err) {
    if (err instanceof CaseMessageRouteError) {
      return privateJson({ error: err.message }, { status: err.status });
    }
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    if (err instanceof DirectUploadClaimError) {
      return privateJson({ error: err.message }, { status: 409 });
    }

    logServerError(err, { source: "case_message_route" });
    return privateJson({ error: "Server error" }, { status: 500 });
  }
}
