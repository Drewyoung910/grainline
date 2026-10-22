import type { Prisma } from '@prisma/client'
type SellerStaffReadClient = Pick<Prisma.TransactionClient, '$queryRaw'>
type SellerStaffMutationClient = Pick<Prisma.TransactionClient, '$queryRaw'>

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

type SellerStaffOrderabilityPublicState = Pick<
  SellerStaffOrderabilityState,
  'id' | 'chargesEnabled' | 'vacationMode'
>

type SellerStaffOrderabilityTransitionRow = {
  sellerProfileId: string
  previousChargesEnabled: boolean
  previousVacationMode: boolean
  changed: boolean
}

/** Actor-bound compare-and-set boundary used inside ban/unban transactions. */
export async function transitionSellerStaffOrderability(
  client: SellerStaffMutationClient,
  input: {
    targetUserId: string
    expected: SellerStaffOrderabilityPublicState | null
    next: Pick<SellerStaffOrderabilityPublicState, 'chargesEnabled' | 'vacationMode'> | null
  },
) {
  if (!input.expected && input.next) {
    throw new Error('Seller staff orderability cannot create a missing profile')
  }
  const rows = await client.$queryRaw<SellerStaffOrderabilityTransitionRow[]>`
    SELECT *
      FROM public.grainline_seller_staff_orderability_transition(
        ${input.targetUserId}::text,
        ${input.expected?.id ?? null}::text,
        ${input.expected?.chargesEnabled ?? null}::boolean,
        ${input.expected?.vacationMode ?? null}::boolean,
        ${input.next?.chargesEnabled ?? null}::boolean,
        ${input.next?.vacationMode ?? null}::boolean
      )
  `
  if (!input.expected) {
    if (rows.length !== 0) {
      throw new Error('Seller staff orderability authority returned an invalid result')
    }
    return null
  }
  const row = rows[0]
  if (
    rows.length !== 1
    || row?.sellerProfileId !== input.expected.id
    || row.previousChargesEnabled !== input.expected.chargesEnabled
    || row.previousVacationMode !== input.expected.vacationMode
    || row.changed !== Boolean(input.next)
  ) {
    throw new Error('Seller staff orderability authority returned an invalid result')
  }
  return {
    id: row.sellerProfileId,
    chargesEnabled: row.previousChargesEnabled,
    vacationMode: row.previousVacationMode,
  }
}
