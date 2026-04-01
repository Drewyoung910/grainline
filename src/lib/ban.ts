import { prisma } from './db'
import { logAdminAction } from './audit'

export async function banUser({ userId, adminId, reason }: {
  userId: string; adminId: string; reason: string
}) {
  await prisma.user.update({
    where: { id: userId },
    data: { banned: true, bannedAt: new Date(), banReason: reason, bannedBy: adminId }
  })
  await prisma.sellerProfile.updateMany({
    where: { userId },
    data: { chargesEnabled: false, vacationMode: true }
  })
  await prisma.commissionRequest.updateMany({
    where: { buyerId: userId, status: 'OPEN' },
    data: { status: 'CLOSED' }
  })
  await logAdminAction({ adminId, action: 'BAN_USER', targetType: 'USER', targetId: userId, reason })
}

export async function unbanUser({ userId, adminId, reason }: {
  userId: string; adminId: string; reason: string
}) {
  await prisma.user.update({
    where: { id: userId },
    data: { banned: false, bannedAt: null, banReason: null, bannedBy: null }
  })
  const seller = await prisma.sellerProfile.findUnique({
    where: { userId }, select: { id: true, stripeAccountId: true }
  })
  if (seller?.stripeAccountId) {
    await prisma.sellerProfile.update({
      where: { id: seller.id },
      data: { chargesEnabled: true, vacationMode: false }
    })
  }
  await logAdminAction({ adminId, action: 'UNBAN_USER', targetType: 'USER', targetId: userId, reason })
}
