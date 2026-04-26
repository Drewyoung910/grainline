import { prisma } from './db'
import { stripe } from './stripe'

export async function banUser({ userId, adminId, reason }: {
  userId: string; adminId: string; reason: string
}) {
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { banned: true, bannedAt: new Date(), banReason: reason, bannedBy: adminId }
    })
    await tx.sellerProfile.updateMany({
      where: { userId },
      data: { chargesEnabled: false, vacationMode: true }
    })
    await tx.commissionRequest.updateMany({
      where: { buyerId: userId, status: 'OPEN' },
      data: { status: 'CLOSED' }
    })
    await tx.adminAuditLog.create({
      data: { adminId, action: 'BAN_USER', targetType: 'USER', targetId: userId, reason }
    })
  })
}

export async function unbanUser({ userId, adminId, reason }: {
  userId: string; adminId: string; reason: string
}) {
  const seller = await prisma.sellerProfile.findUnique({
    where: { userId }, select: { id: true, stripeAccountId: true }
  })
  let sellerRestore: { id: string; chargesEnabled: boolean; vacationMode: boolean } | null = null
  if (seller?.stripeAccountId) {
    let chargesEnabled = false
    try {
      const account = await stripe.accounts.retrieve(seller.stripeAccountId)
      chargesEnabled = Boolean(
        account.charges_enabled &&
        account.details_submitted &&
        !account.requirements?.disabled_reason
      )
    } catch (err) {
      console.error("Failed to verify Stripe account during unban:", err)
    }
    sellerRestore = { id: seller.id, chargesEnabled, vacationMode: !chargesEnabled }
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { banned: false, bannedAt: null, banReason: null, bannedBy: null }
    })
    if (sellerRestore) {
      await tx.sellerProfile.update({
        where: { id: sellerRestore.id },
        data: {
          chargesEnabled: sellerRestore.chargesEnabled,
          vacationMode: sellerRestore.vacationMode,
        }
      })
    }
    await tx.adminAuditLog.create({
      data: { adminId, action: 'UNBAN_USER', targetType: 'USER', targetId: userId, reason }
    })
  })
}
