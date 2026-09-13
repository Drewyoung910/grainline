import { prisma } from "@/lib/db";
import { renderCaseResolvedEmail } from "@/lib/email";
import {
  enqueueEmailOutboxOnce,
  processEmailOutboxJobById,
} from "@/lib/emailOutbox";
import {
  finalizeCaseStaffResolution,
  type PreparedCaseStaffResolution,
} from "@/lib/caseStaffResolutionAuthority";
import {
  caseResolutionCopy,
  caseResolutionSellerMessage,
} from "@/lib/caseResolutionCopy";
import { createNotificationOrThrow } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";

/**
 * Commits the Case transition and every durable participant-delivery record in
 * one transaction. The email worker remains the delivery boundary, so a crash
 * after commit can retry the deterministic outbox row without replaying the
 * Stripe refund or the Case transition.
 */
export async function finalizeCaseStaffResolutionWithSideEffects(
  actorUserId: string,
  prepared: PreparedCaseStaffResolution,
) {
  const committed = await prisma.$transaction(async (tx) => {
    const result = await finalizeCaseStaffResolution(
      actorUserId,
      prepared,
      tx,
    );
    const refunding = result.resolution !== "DISMISSED";
    const resolutionCopy = caseResolutionCopy(
      result.resolution,
      result.refundAmountCents,
      result.currency,
    );

    if (result.buyerUserId) {
      await createNotificationOrThrow({
        userId: result.buyerUserId,
        type: refunding ? "REFUND_ISSUED" : "CASE_RESOLVED",
        title: resolutionCopy.notificationTitle,
        body: resolutionCopy.body,
        sourceType: NOTIFICATION_SOURCE_TYPES.CASE,
        sourceId: result.caseId,
        relatedUserId: actorUserId,
      }, tx);
    }

    await createNotificationOrThrow({
      userId: result.sellerUserId,
      type: "CASE_MESSAGE",
      title: "Grainline resolved a case",
      body: caseResolutionSellerMessage(
        result.resolution,
        result.refundAmountCents,
        result.currency,
      ),
      sourceType: NOTIFICATION_SOURCE_TYPES.CASE_MESSAGE,
      sourceId: result.resolutionMessageId,
      relatedUserId: actorUserId,
    }, tx);

    let emailOutboxId: string | null = null;
    if (result.buyerUserId) {
      const buyer = await tx.user.findUnique({
        where: { id: result.buyerUserId },
        select: { name: true, email: true },
      });
      if (buyer?.email) {
        const email = renderCaseResolvedEmail({
          orderId: result.orderId,
          buyer,
          resolution: result.resolution,
          refundAmountCents: result.refundAmountCents,
          currency: result.currency,
        });
        const enqueued = await enqueueEmailOutboxOnce(
          {
            ...email,
            dedupKey: `case-resolution:${result.claimId}`,
            templateName: "case_resolved",
            userId: result.buyerUserId,
            preferenceKey: refunding
              ? "EMAIL_REFUND_ISSUED"
              : "EMAIL_CASE_RESOLVED",
            sourceType: NOTIFICATION_SOURCE_TYPES.CASE,
            sourceId: result.claimId,
          },
          tx,
        );
        emailOutboxId = enqueued.job?.id ?? null;
      }
    }

    return { result, emailOutboxId };
  });

  if (committed.emailOutboxId) {
    const delivery = await processEmailOutboxJobById(
      committed.emailOutboxId,
    );
    if (delivery === "missing") {
      throw new Error("Committed Case-resolution email outbox row is missing");
    }
  }

  return committed.result;
}
