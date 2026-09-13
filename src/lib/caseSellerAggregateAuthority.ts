import { prisma } from "@/lib/db";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";
import {
  validateCaseGuildUnresolvedGuard,
  validateCaseSellerActiveCount,
  validateCaseVerificationEligibility,
} from "@/lib/caseSellerAggregateResult";

type CaseSellerAggregateClient = Pick<typeof prisma, "$queryRaw">;

const SELLER_PROFILE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;

function normalizeSellerProfileId(value: string) {
  if (
    value !== value.trim()
    || !SELLER_PROFILE_ID_PATTERN.test(value)
  ) {
    throw new TypeError(
      "Case seller aggregate authority requires a bounded SellerProfile id",
    );
  }
  return value;
}

export async function getCaseSellerActiveCount(
  sellerProfileIdInput: string,
  db: CaseSellerAggregateClient = prisma,
) {
  const sellerProfileId = normalizeSellerProfileId(sellerProfileIdInput);
  const rows = await db.$queryRaw<unknown[]>`
    SELECT *
      FROM public.grainline_case_seller_active_count(
        ${sellerProfileId}::text
      )
  `;
  return validateCaseSellerActiveCount(rows);
}

export async function getCaseSellerVerificationEligibility(
  input: { actorUserId: string; sellerProfileId: string },
  db: CaseSellerAggregateClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const sellerProfileId = normalizeSellerProfileId(input.sellerProfileId);
  const rows = await db.$queryRaw<unknown[]>`
    SELECT *
      FROM public.grainline_case_seller_verification_eligibility(
        ${actorUserId}::text,
        ${sellerProfileId}::text
      )
  `;
  return validateCaseVerificationEligibility(rows);
}

export async function getCaseGuildUnresolvedGuard(
  sellerProfileIdInput: string,
  db: CaseSellerAggregateClient = prisma,
) {
  const sellerProfileId = normalizeSellerProfileId(sellerProfileIdInput);
  const rows = await db.$queryRaw<unknown[]>`
    SELECT *
      FROM public.grainline_case_guild_unresolved_guard(
        ${sellerProfileId}::text
      )
  `;
  return validateCaseGuildUnresolvedGuard(rows);
}
