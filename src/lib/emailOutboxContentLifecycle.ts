import type { Prisma } from "@prisma/client";

type EmailOutboxMutationClient = Pick<Prisma.TransactionClient, "emailOutbox">;

export const EMAIL_OUTBOX_EXPORT_SELECT = {
  id: true,
  recipientEmail: true,
  userId: true,
  preferenceKey: true,
  templateName: true,
  templateVersion: true,
  sourceType: true,
  sourceId: true,
  subject: true,
  payloadVersion: true,
  payload: true,
  status: true,
  attempts: true,
  nextAttemptAt: true,
  sentAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EmailOutboxSelect;

export async function redactEmailOutboxRepresentations(
  client: EmailOutboxMutationClient,
  where: Prisma.EmailOutboxWhereInput,
  legacyReplacement: { subject: string; html: string },
) {
  const legacy = await client.emailOutbox.updateMany({
    where: { AND: [where, { payloadVersion: null }] },
    data: legacyReplacement,
  });
  const structured = await client.emailOutbox.updateMany({
    where: { AND: [where, { payloadVersion: { not: null } }] },
    data: { payload: {} },
  });
  return { legacy: legacy.count, structured: structured.count };
}

export function sellerBroadcastOutboxCancellationWhere(
  broadcastId: string,
): Prisma.EmailOutboxWhereInput {
  return {
    preferenceKey: "EMAIL_SELLER_BROADCAST",
    sourceType: "seller_broadcast",
    sourceId: broadcastId,
    status: { in: ["PENDING", "FAILED"] },
  };
}
