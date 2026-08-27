import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type TransferBindingClient = Pick<typeof prisma, "$queryRaw">;

export type BlockedCheckoutTransferBinding = Readonly<{
  action: "bound" | "replay";
  orderId: string;
  transferId: string;
}>;

function requiredString(value: unknown, label: string, maxLength: number) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maxLength
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function validateBinding(
  value: unknown,
  expectedOrderId: string,
  expectedTransferId: string,
): BlockedCheckoutTransferBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Blocked-checkout transfer binding returned a non-object");
  }
  const record = value as Record<string, unknown>;
  const action = record.action;
  if (action !== "bound" && action !== "replay") {
    throw new TypeError("Blocked-checkout transfer binding action is invalid");
  }
  const orderId = requiredString(
    record.orderId,
    "Blocked-checkout transfer binding Order",
    191,
  );
  const transferId = requiredString(
    record.transferId,
    "Blocked-checkout transfer binding transfer",
    255,
  );
  if (orderId !== expectedOrderId || transferId !== expectedTransferId) {
    throw new TypeError("Blocked-checkout transfer binding identity drifted");
  }
  return Object.freeze({ action, orderId, transferId });
}

export async function bindBlockedCheckoutTransfer(
  input: {
    eventId: string;
    eventClaimGeneration: bigint;
    sessionId: string;
    orderId: string;
    paymentIntentId: string;
    chargeId: string;
    transferId: string;
  },
  client: TransferBindingClient = prisma,
) {
  const rows = await client.$queryRaw<Array<{ binding: unknown }>>(Prisma.sql`
    SELECT public.grainline_blocked_checkout_transfer_bind(
      ${input.eventId}::text,
      ${input.eventClaimGeneration}::bigint,
      ${input.sessionId}::text,
      ${input.orderId}::text,
      ${input.paymentIntentId}::text,
      ${input.chargeId}::text,
      ${input.transferId}::text
    ) AS binding
  `);
  if (rows.length !== 1) {
    throw new TypeError("Blocked-checkout transfer binding returned an invalid row count");
  }
  return validateBinding(rows[0]?.binding, input.orderId, input.transferId);
}
