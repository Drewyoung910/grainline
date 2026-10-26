import { randomUUID } from "node:crypto";
import { EmailSuppressionReason, type Prisma } from "@prisma/client";

type EmailSuppressionAccessClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type HardEmailSuppressionReason =
  | typeof EmailSuppressionReason.BOUNCE
  | typeof EmailSuppressionReason.COMPLAINT;

export type HardEmailSuppressionSource =
  | "resend"
  | "resend_provider_suppressed";

export type StoredHardEmailSuppression = {
  email: string;
  reason: EmailSuppressionReason;
  source: string;
  eventId: string | null;
  details: Prisma.JsonValue;
};

export async function applyEmailHardSuppression(
  client: EmailSuppressionAccessClient,
  input: {
    email: string;
    reason: HardEmailSuppressionReason;
    source: HardEmailSuppressionSource;
    eventId?: string;
    details?: Prisma.InputJsonValue;
  },
): Promise<StoredHardEmailSuppression> {
  const rows = await client.$queryRaw<StoredHardEmailSuppression[]>`
    SELECT *
      FROM public.grainline_email_hard_suppression_apply(
        ${randomUUID()}::text,
        ${input.email}::text,
        ${input.reason}::public."EmailSuppressionReason",
        ${input.source}::text,
        ${input.eventId ?? null}::text,
        ${JSON.stringify(input.details ?? {})}::jsonb
      )
  `;
  const suppression = rows[0];
  if (
    rows.length !== 1
    || !suppression
    || suppression.email !== input.email
    || (
      suppression.reason !== EmailSuppressionReason.BOUNCE
      && suppression.reason !== EmailSuppressionReason.COMPLAINT
    )
    || typeof suppression.source !== "string"
    || (suppression.eventId !== null && typeof suppression.eventId !== "string")
    || typeof suppression.details !== "object"
    || suppression.details === null
  ) {
    throw new Error("Email hard-suppression authority returned an invalid result");
  }
  return suppression;
}
