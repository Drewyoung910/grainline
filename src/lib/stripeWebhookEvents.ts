import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  stripeWebhookCompletionFromRows,
  stripeWebhookEventLastError,
  stripeWebhookEventReservationFromRows,
  stripeWebhookFailureFromRows,
  type StripeWebhookCompletion,
  type StripeWebhookEventReservation,
  type StripeWebhookFailure,
} from "@/lib/stripeWebhookEventState";

type StripeWebhookEventClient = Pick<Prisma.TransactionClient, "$queryRaw">;
export type { StripeWebhookEventReservation } from "@/lib/stripeWebhookEventState";

export async function beginStripeWebhookEvent(
  id: string,
  type: string,
  client: StripeWebhookEventClient = prisma,
): Promise<StripeWebhookEventReservation> {
  const rows = await client.$queryRaw<Array<{
    action: unknown;
    claim_generation: unknown;
  }>>`
    SELECT action, claim_generation
      FROM public.grainline_stripe_webhook_begin(${id}, ${type})
  `;
  return stripeWebhookEventReservationFromRows(rows);
}

export async function markStripeWebhookEventProcessed(
  id: string,
  claimGeneration: bigint,
  client: StripeWebhookEventClient = prisma,
): Promise<StripeWebhookCompletion> {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_stripe_webhook_complete(
      ${id},
      ${claimGeneration}
    ) AS result
  `;
  return stripeWebhookCompletionFromRows(rows);
}

export async function markStripeWebhookEventFailed(
  id: string,
  claimGeneration: bigint,
  error: unknown,
  client: StripeWebhookEventClient = prisma,
): Promise<StripeWebhookFailure> {
  const sanitizedError = stripeWebhookEventLastError(error);
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_stripe_webhook_fail(
      ${id},
      ${claimGeneration},
      ${sanitizedError}
    ) AS result
  `;
  return stripeWebhookFailureFromRows(rows);
}
