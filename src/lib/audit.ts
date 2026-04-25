import { ListingStatus } from '@prisma/client'
import { prisma } from './db'
import { stripe } from './stripe'

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

  const metadata = (log.metadata && typeof log.metadata === 'object' && !Array.isArray(log.metadata))
    ? log.metadata as Record<string, unknown>
    : {}

  let sellerRestore: { id: string; chargesEnabled: boolean; vacationMode: boolean } | null = null
  if (log.action === 'BAN_USER') {
    const seller = await prisma.sellerProfile.findUnique({
      where: { userId: log.targetId },
      select: { id: true, stripeAccountId: true },
    })
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
        console.error('Failed to verify Stripe account during admin undo:', err)
      }
      sellerRestore = { id: seller.id, chargesEnabled, vacationMode: !chargesEnabled }
    }
  }

  await prisma.$transaction(async (tx) => {
    // Atomic lock: only one undo can succeed, and the flag rolls back if the
    // undo operation fails.
    const locked = await tx.adminAuditLog.updateMany({
      where: { id: logId, undone: false },
      data: { undone: true, undoneAt: new Date(), undoneBy: adminId, undoneReason: reason },
    })
    if (locked.count === 0) throw new Error('Already undone (concurrent request)')

    switch (log.action) {
      case 'BAN_USER':
        await tx.user.update({
          where: { id: log.targetId },
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
        break
      case 'REMOVE_LISTING':
      case 'HOLD_LISTING': {
        const previousStatus =
          typeof metadata.previousStatus === 'string' &&
          Object.values(ListingStatus).includes(metadata.previousStatus as ListingStatus)
            ? metadata.previousStatus as ListingStatus
            : ListingStatus.ACTIVE
        await tx.listing.update({
          where: { id: log.targetId },
          data: { status: previousStatus }
        })
        break
      }
      default:
        throw new Error(`Action '${log.action}' cannot be undone`)
    }

    await tx.adminAuditLog.create({
      data: {
        adminId,
        action: `UNDO_${log.action}`,
        targetType: log.targetType,
        targetId: log.targetId,
        reason,
        metadata: { originalActionId: logId },
      },
    })
  })
}
