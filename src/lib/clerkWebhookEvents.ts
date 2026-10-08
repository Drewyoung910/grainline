import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  clerkWebhookCompletionFromRows,
  clerkWebhookEventLastError,
  clerkWebhookEventReservationFromRows,
  clerkWebhookFailureFromRows,
  type ClerkWebhookCompletion,
  type ClerkWebhookEventReservation,
  type ClerkWebhookFailure,
} from "@/lib/clerkWebhookEventState";

type ClerkWebhookEventClient = Pick<Prisma.TransactionClient, "$queryRaw">;
export type { ClerkWebhookEventReservation } from "@/lib/clerkWebhookEventState";

export async function reserveClerkWebhookEvent(
  svixId: string,
  type: string,
  client: ClerkWebhookEventClient = prisma,
): Promise<ClerkWebhookEventReservation> {
  const rows = await client.$queryRaw<Array<{ action: unknown; claim_generation: unknown }>>`
    SELECT action, claim_generation
      FROM public.grainline_clerk_webhook_begin(${svixId}, ${type})
  `;
  return clerkWebhookEventReservationFromRows(rows);
}

export async function markClerkWebhookProcessed(
  svixId: string,
  claimGeneration: bigint,
  client: ClerkWebhookEventClient = prisma,
): Promise<ClerkWebhookCompletion> {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_clerk_webhook_complete(
      ${svixId},
      ${claimGeneration}
    ) AS result
  `;
  return clerkWebhookCompletionFromRows(rows);
}

export async function markClerkWebhookFailed(
  svixId: string,
  claimGeneration: bigint,
  error: unknown,
  client: ClerkWebhookEventClient = prisma,
): Promise<ClerkWebhookFailure> {
  const sanitizedError = clerkWebhookEventLastError(error);
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_clerk_webhook_fail(
      ${svixId},
      ${claimGeneration},
      ${sanitizedError}
    ) AS result
  `;
  return clerkWebhookFailureFromRows(rows);
}
