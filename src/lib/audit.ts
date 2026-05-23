import * as Sentry from '@sentry/nextjs'
import { prisma } from './db'
import { adminUndoActorBlockReason, adminUndoWindowBlockReason } from './adminAuditUndoState'
import { listingUndoCurrentStatusWhere, listingUndoDataFromMetadata } from './adminListingUndoState'
import { readBanAuditMetadata } from './banAuditMetadata'
import { unbanClerkUser } from './clerkUserLifecycle'
import { sanitizeText, truncateText } from './sanitize'
import { invalidateAccountStateCache } from './accountStateCache'

export const UNDOABLE_ADMIN_ACTIONS = ['BAN_USER', 'REMOVE_LISTING', 'HOLD_LISTING'] as const

export function isUndoableAdminAction(action: string): boolean {
  return (UNDOABLE_ADMIN_ACTIONS as readonly string[]).includes(action)
}

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
      data: {
        adminId,
        action,
        targetType,
        targetId,
        reason: reason ? truncateText(sanitizeText(reason), 500) || null : undefined,
        metadata: metadata as Parameters<typeof prisma.adminAuditLog.create>[0]['data']['metadata'],
      }
    })
    return log.id
  } catch (error) {
    console.error('Audit log failed:', error)
    Sentry.captureException(error, {
      tags: { source: 'audit_log', action },
      extra: { adminId, targetType, targetId },
    })
    return ''
  }
}

export async function logUserAuditAction({
  actorId,
  action,
  targetType,
  targetId,
  reason,
  metadata = {},
}: {
  actorId: string
  action: string
  targetType: string
  targetId: string
  reason?: string
  metadata?: Record<string, unknown>
}): Promise<string> {
  return logAdminAction({
    adminId: actorId,
    action,
    targetType,
    targetId,
    reason,
    metadata: { ...metadata, actorKind: 'user' },
  })
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
  const windowBlockReason = adminUndoWindowBlockReason({ createdAt: log.createdAt })
  if (windowBlockReason) throw new Error(windowBlockReason)
  if (!isUndoableAdminAction(log.action)) throw new Error(`Action '${log.action}' cannot be undone`)
  const actorBlockReason = adminUndoActorBlockReason({
    actionAdminId: log.adminId,
    actingAdminId: adminId,
  })
  if (actorBlockReason) throw new Error(actorBlockReason)

  const metadata = (log.metadata && typeof log.metadata === 'object' && !Array.isArray(log.metadata))
    ? log.metadata as Record<string, unknown>
    : {}
  const banMetadata = log.action === 'BAN_USER' ? readBanAuditMetadata(metadata) : null

  let sellerRestore: { id: string; chargesEnabled: boolean; vacationMode: boolean } | null = null
  if (log.action === 'BAN_USER') {
    if (banMetadata?.previousSellerProfile) {
      sellerRestore = banMetadata.previousSellerProfile
    } else {
      const seller = await prisma.sellerProfile.findUnique({
        where: { userId: log.targetId },
        select: { id: true, stripeAccountId: true },
      })
      if (seller?.stripeAccountId) {
        let chargesEnabled = false
        try {
          const { stripe } = await import('./stripe')
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
  }
  const clerkUnbanTarget = log.action === 'BAN_USER'
    ? await prisma.user.findUnique({
        where: { id: log.targetId },
        select: { clerkId: true },
      })
    : null

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
        if (banMetadata?.previousCommissionRequests.length) {
          await Promise.all(
            banMetadata.previousCommissionRequests.map((request) =>
              tx.commissionRequest.updateMany({
                where: { id: request.id, buyerId: log.targetId, status: 'CLOSED' },
                data: { status: request.status },
              })
            )
          )
        }
        break
      case 'REMOVE_LISTING':
      case 'HOLD_LISTING': {
        const updated = await tx.listing.updateMany({
          where: listingUndoCurrentStatusWhere(log.action, log.targetId),
          data: listingUndoDataFromMetadata(metadata)
        })
        if (updated.count === 0) throw new Error('Listing changed before undo could be applied')
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

  if (log.action === 'BAN_USER' && clerkUnbanTarget?.clerkId) {
    await invalidateAccountStateCache(clerkUnbanTarget.clerkId, 'admin_undo_ban_account_state_cache_invalidate')
    try {
      await unbanClerkUser(clerkUnbanTarget.clerkId)
      await logAdminAction({
        adminId,
        action: 'UNDO_BAN_USER_CLERK_SYNC',
        targetType: log.targetType,
        targetId: log.targetId,
        metadata: { originalActionId: logId, clerkUserId: clerkUnbanTarget.clerkId },
      })
    } catch (error) {
      Sentry.captureException(error, {
        tags: { source: 'undo_ban_user_clerk_sync' },
        extra: { logId, adminId, targetId: log.targetId, clerkUserId: clerkUnbanTarget.clerkId },
      })
      await logAdminAction({
        adminId,
        action: 'UNDO_BAN_USER_CLERK_SYNC_FAILED',
        targetType: log.targetType,
        targetId: log.targetId,
        metadata: {
          originalActionId: logId,
          clerkUserId: clerkUnbanTarget.clerkId,
          error: error instanceof Error ? error.message : String(error),
        },
      })
      throw new Error('Database undo succeeded, but Clerk could not be unbanned. Retry the undo or contact support.')
    }
  }
}
