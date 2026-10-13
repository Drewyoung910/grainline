import type { Prisma } from '@prisma/client'
import { prisma } from './db'

type SellerStaffPrivateClient = Pick<Prisma.TransactionClient, 'sellerProfile'>

const sellerStaffOrderabilitySelect = {
  id: true,
  chargesEnabled: true,
  vacationMode: true,
  stripeAccountId: true,
} satisfies Prisma.SellerProfileSelect

/** Compatibility boundary for staff ban/unban and audited undo operations. */
export function sellerStaffOrderabilityState(
  userId: string,
  client: SellerStaffPrivateClient = prisma,
) {
  return client.sellerProfile.findUnique({
    where: { userId },
    select: sellerStaffOrderabilitySelect,
  })
}

export function setSellerStaffOrderability(
  client: SellerStaffPrivateClient,
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
  client: SellerStaffPrivateClient,
  userId: string,
) {
  return client.sellerProfile.updateMany({
    where: { userId },
    data: { chargesEnabled: false, vacationMode: true },
  })
}
