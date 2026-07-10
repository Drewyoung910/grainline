import type { Prisma } from "@prisma/client";
import { logSystemActionOrThrow } from "@/lib/systemAudit";
import {
  buildLocalRefundEvidenceRecords,
  localRefundEvidenceEventId,
  type LocalRefundEvidenceAction,
  type LocalRefundEvidenceInput,
} from "./localRefundEvidenceCore.ts";

type LocalRefundEvidenceClient = Pick<Prisma.TransactionClient, "orderPaymentEvent" | "systemAuditLog">;

export { localRefundEvidenceEventId };
export type { LocalRefundEvidenceAction };

export async function recordLocalRefundEvidence(
  client: LocalRefundEvidenceClient,
  input: LocalRefundEvidenceInput,
) {
  const { ledgerData, auditData } = buildLocalRefundEvidenceRecords(input);

  const ledgerWrite = await client.orderPaymentEvent.createMany({
    data: ledgerData,
    skipDuplicates: true,
  });
  if (ledgerWrite.count === 0) return;

  await logSystemActionOrThrow({
    client,
    ...auditData,
  });
}
