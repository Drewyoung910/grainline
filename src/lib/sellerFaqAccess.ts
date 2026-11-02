import { randomUUID } from "node:crypto";
import {
  type DbUserContextTransactionClient,
  withDbUserContext,
  withSerializableDbUserContext,
} from "@/lib/dbUserContext";

const SELLER_FAQ_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/u;

export type SellerFaqCreateStatus = "OK" | "LIMIT_REACHED";

type SellerFaqCreateRow = {
  resultStatus: string;
  id: string | null;
  sortOrder: number | null;
  created: boolean;
};

export type SellerFaqExportRow = {
  id: string;
  question: string;
  answer: string;
  sortOrder: number;
  createdAt: Date;
};

function exactCount(value: unknown, label: string) {
  const count = typeof value === "bigint" ? Number(value) : value;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new TypeError(`${label} returned an invalid count`);
  }
  return count;
}

export function createOwnerSellerFaq(
  userId: string,
  question: string,
  answer: string,
) {
  const proposedFaqId = randomUUID();
  return withSerializableDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<SellerFaqCreateRow[]>`
      SELECT
        result."resultStatus",
        result.id,
        result."sortOrder",
        result.created
      FROM public.grainline_seller_faq_owner_create(
        ${proposedFaqId}::text,
        ${question}::text,
        ${answer}::text
      ) AS result
    `;
    const row = rows[0];
    if (
      rows.length !== 1
      || !row
      || !["OK", "LIMIT_REACHED"].includes(row.resultStatus)
      || typeof row.created !== "boolean"
      || (
        row.resultStatus === "OK"
        && (
          typeof row.id !== "string"
          || !SELLER_FAQ_ID_PATTERN.test(row.id)
          || !Number.isSafeInteger(row.sortOrder)
          || Number(row.sortOrder) < 1
        )
      )
      || (
        row.resultStatus === "LIMIT_REACHED"
        && (row.id !== null || row.sortOrder !== null || row.created)
      )
    ) {
      throw new TypeError("SellerFaq create authority returned an invalid result");
    }
    return row as SellerFaqCreateRow & { resultStatus: SellerFaqCreateStatus };
  });
}

export function removeOwnerSellerFaq(userId: string, faqId: string) {
  if (!SELLER_FAQ_ID_PATTERN.test(faqId)) {
    throw new RangeError("SellerFaq id is outside the supported range");
  }
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<Array<{ value: bigint | number }>>`
      SELECT public.grainline_seller_faq_owner_remove(${faqId}::text) AS value
    `;
    if (rows.length !== 1) {
      throw new TypeError("SellerFaq remove authority returned invalid cardinality");
    }
    const deleted = exactCount(rows[0]?.value, "SellerFaq remove authority");
    if (deleted > 1) {
      throw new TypeError("SellerFaq remove authority deleted too many rows");
    }
    return deleted;
  });
}

export function ownerSellerFaqExportRows(userId: string) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<SellerFaqExportRow[]>`
      SELECT * FROM public.grainline_seller_faq_owner_export()
    `;
    if (rows.some((row) => (
      typeof row.id !== "string"
      || !SELLER_FAQ_ID_PATTERN.test(row.id)
      || typeof row.question !== "string"
      || typeof row.answer !== "string"
      || !Number.isSafeInteger(row.sortOrder)
      || row.sortOrder < 0
      || !(row.createdAt instanceof Date)
      || Number.isNaN(row.createdAt.getTime())
    ))) {
      throw new TypeError("SellerFaq export authority returned an invalid row");
    }
    return rows;
  });
}

export async function cleanupSellerFaqsForAccountDeletion(
  client: DbUserContextTransactionClient,
  input: {
    sideEffectId: string;
    expectedUserId: string;
    claimGeneration: bigint;
    claimToken: string;
  },
) {
  const rows = await client.$queryRaw<Array<{ value: bigint | number }>>`
    SELECT public.grainline_seller_faq_account_deletion_cleanup(
      ${input.sideEffectId}::text,
      ${input.expectedUserId}::text,
      ${input.claimGeneration}::bigint,
      ${input.claimToken}::uuid
    ) AS value
  `;
  if (rows.length !== 1) {
    throw new TypeError("SellerFaq account-deletion authority returned invalid cardinality");
  }
  return exactCount(rows[0]?.value, "SellerFaq account-deletion authority");
}
