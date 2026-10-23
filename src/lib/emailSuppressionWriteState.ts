import { EmailSuppressionReason, Prisma } from "@prisma/client";
import { preserveDirectResendSuppression } from "./resendWebhookEventState.ts";

export type StoredEmailSuppression = {
  email: string;
  reason: EmailSuppressionReason;
  source: string | null;
  eventId: string | null;
  details: Prisma.JsonValue;
};

export type EmailSuppressionWriteClient = {
  updateMany: (args: Prisma.EmailSuppressionUpdateManyArgs) => Promise<Prisma.BatchPayload>;
  findUnique: (
    args: Prisma.EmailSuppressionFindUniqueArgs,
  ) => Promise<StoredEmailSuppression | null>;
  create: (
    args: Prisma.EmailSuppressionCreateArgs,
  ) => Promise<StoredEmailSuppression>;
};

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object"
    && err !== null
    && "code" in err
    && (err as { code?: unknown }).code === "P2002";
}

export async function storeProviderSuppressionWithoutWeakeningDirectEvidence(
  client: EmailSuppressionWriteClient,
  opts: {
    email: string;
    reason: EmailSuppressionReason;
    source: "resend_provider_suppressed";
    eventId?: string;
    details?: Prisma.InputJsonValue;
  },
): Promise<StoredEmailSuppression> {
  const data = {
    reason: opts.reason,
    source: opts.source,
    eventId: opts.eventId,
    details: opts.details ?? {},
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const updated = await client.updateMany({
      where: {
        email: opts.email,
        OR: [
          { source: null },
          { source: { not: "resend" } },
          { reason: { notIn: [EmailSuppressionReason.BOUNCE, EmailSuppressionReason.COMPLAINT] } },
        ],
      },
      data,
    });
    if (updated.count === 1) {
      const stored = await client.findUnique({ where: { email: opts.email } });
      if (stored) return stored;
      continue;
    }

    const existing = await client.findUnique({ where: { email: opts.email } });
    if (existing && preserveDirectResendSuppression(existing, data)) return existing;
    if (existing) continue;

    try {
      return await client.create({
        data: { email: opts.email, ...data },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }

  throw new Error("Email suppression changed repeatedly during provider suppression");
}
