import { prisma } from './db'

export async function logAdminAction({
  adminId,
  action,
  targetType,
  targetId,
  reason,
  metadata = {},
}: {
  adminId: string
  action: string
  targetType: string
  targetId: string
  reason?: string
  metadata?: Record<string, unknown>
}): Promise<string> {
  try {
    const log = await prisma.adminAuditLog.create({
      data: { adminId, action, targetType, targetId, reason, metadata: metadata as Parameters<typeof prisma.adminAuditLog.create>[0]['data']['metadata'] }
    })
    return log.id
  } catch (error) {
    console.error('Audit log failed:', error)
    return ''
  }
}

export async function undoAdminAction({
  logId,
  adminId,
  reason,
}: {
  logId: string
  adminId: string
  reason: string
}) {
  const log = await prisma.adminAuditLog.findUnique({ where: { id: logId } })
  if (!log) throw new Error('Action not found')
  if (log.undone) throw new Error('Already undone')
  const hoursAgo = (Date.now() - log.createdAt.getTime()) / 3600000
  if (hoursAgo > 24) throw new Error('Undo window expired (24 hours)')

  switch (log.action) {
    case 'BAN_USER':
      await prisma.user.update({
        where: { id: log.targetId },
        data: { banned: false, bannedAt: null, banReason: null, bannedBy: null }
      })
      {
        const seller = await prisma.sellerProfile.findUnique({
          where: { userId: log.targetId },
          select: { id: true, stripeAccountId: true }
        })
        if (seller?.stripeAccountId) {
          await prisma.sellerProfile.update({
            where: { id: seller.id },
            data: { chargesEnabled: true, vacationMode: false }
          })
        }
      }
      break
    case 'REMOVE_LISTING':
    case 'HOLD_LISTING':
      await prisma.listing.update({
        where: { id: log.targetId },
        data: { status: 'ACTIVE' }
      })
      break
    default:
      throw new Error(`Action '${log.action}' cannot be undone`)
  }

  await prisma.adminAuditLog.update({
    where: { id: logId },
    data: { undone: true, undoneAt: new Date(), undoneBy: adminId, undoneReason: reason }
  })

  await logAdminAction({
    adminId,
    action: `UNDO_${log.action}`,
    targetType: log.targetType,
    targetId: log.targetId,
    reason,
    metadata: { originalActionId: logId }
  })
}
