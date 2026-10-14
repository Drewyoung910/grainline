import type { Prisma } from '@prisma/client'
type SellerStaffReadClient = Pick<Prisma.TransactionClient, '$queryRaw'>
type SellerStaffMutationClient = Pick<Prisma.TransactionClient, 'sellerProfile'>

export type SellerStaffOrderabilityState = {
  id: string
  chargesEnabled: boolean
  vacationMode: boolean
  stripeAccountId: string | null
}

/** Compatibility boundary for staff ban/unban and audited undo operations. */
export async function sellerStaffOrderabilityState(
  client: SellerStaffReadClient,
  input: { actorId: string; targetUserId: string },
) {
  const rows = await client.$queryRaw<SellerStaffOrderabilityState[]>`
    SELECT *
      FROM public.grainline_seller_staff_orderability_state(
        ${input.actorId},
        ${input.targetUserId}
      )
  `
  return rows[0] ?? null
}

export function setSellerStaffOrderability(
  client: SellerStaffMutationClient,
  input: {
    sellerProfileId: string
    userId?: string
    chargesEnabled: boolean
    vacationMode: boolean
  },
) {
  return client.sellerProfile.updateMany({
    where: {
      id: input.sellerProfileId,
      ...(input.userId ? { userId: input.userId } : {}),
    },
    data: {
      chargesEnabled: input.chargesEnabled,
      vacationMode: input.vacationMode,
    },
  })
}

export function disableSellerForStaff(
  client: SellerStaffMutationClient,
  userId: string,
) {
  return client.sellerProfile.updateMany({
    where: { userId },
    data: { chargesEnabled: false, vacationMode: true },
  })
}
