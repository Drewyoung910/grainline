import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { publicActiveMemberCountFromRows } from "@/lib/userPublicIdentityState";

type UserPublicIdentityClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function getPublicActiveMemberCount(
  client: UserPublicIdentityClient = prisma,
) {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT public.grainline_user_public_active_member_count() AS value
  `;
  return publicActiveMemberCountFromRows(rows);
}
