import * as Sentry from '@sentry/nextjs'
import type { Prisma } from '@prisma/client'
import { adminUndoActorBlockReason, adminUndoWindowBlockReason } from './adminAuditUndoState'
import { readBanAuditMetadata } from './banAuditMetadata'
import {
  mintBanReviewCapability,
  restoreBannedSellerOrderReviews,
} from './orderBanReviewAuthority'
import { getOrderStaffReadClient } from './orderStaffReadDb'
import { unbanClerkUser } from './clerkUserLifecycle'
import { sanitizeText, truncateText } from './sanitize'
import { invalidateAccountStateCache } from './accountStateCache'
import { sanitizeEmailOutboxError } from './emailOutboxSanitize'
import { withDbUserContext } from './dbUserContext'
import { restoreCommissionRequestsForStaffBan } from './commissionRequestAccess'
import {
  revalidateFeaturedMakerCaches,
  revalidateListingSearchCaches,
  revalidatePublicSellerVisibilityCaches,
} from './searchCache'
import {
  mintUserStaffCapability,
  userStaffBanTarget,
  userStaffUnbanApply,
} from './userStaffAccess'
import {
  sellerStaffOrderabilityState,
  transitionSellerStaffOrderability,
} from './sellerStaffPrivateAccess'
import {
  type AdminAuditLogUndoSource,
  appendAdminAuditLog,
  appendAdminAuditLogForActor,
  adminAuditLogStaffUndoSource,
  adminAuditLogUndoClaim,
} from './adminAuditLogAccess'
import { sellerProfileStaffListingUndoTransition } from './sellerProfileStaffAccess'

export const UNDOABLE_ADMIN_ACTIONS = ['BAN_USER', 'REMOVE_LISTING', 'HOLD_LISTING'] as const

type AdminAuditLogClient = Pick<Prisma.TransactionClient, '$queryRaw'>

type AdminAuditLogInput = {
  adminId: string
  action: string
  targetType: string
  targetId: string
  reason?: string
  metadata?: Record<string, unknown>
}

export class AdminAuditLogError extends Error {
  constructor(message = 'Admin audit log failed') {
    super(message)
    this.name = 'AdminAuditLogError'
  }
}

export function isUndoableAdminAction(action: string): boolean {
  return (UNDOABLE_ADMIN_ACTIONS as readonly string[]).includes(action)
}

export function sanitizeAdminAuditReason(reason: string | null | undefined): string | null | undefined {
  return reason ? truncateText(sanitizeText(reason), 500) || null : undefined
}

function dateFromMetadata(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

async function retryUndoBanClerkSyncIfPending(
  log: AdminAuditLogUndoSource,
  adminId: string,
) {
  if (log.action !== 'BAN_USER') return false
  if (log.latestUndoSyncAction !== 'UNDO_BAN_USER_CLERK_SYNC_FAILED') {
    return false
  }

  const clerkUnbanTarget = await userStaffBanTarget(getOrderStaffReadClient(), {
    actorId: adminId,
    targetId: log.targetId,
  })
  if (!clerkUnbanTarget) throw new Error('Undo target user not found')
  if (clerkUnbanTarget.deletedAt) throw new Error('Undo target account has been deleted')
  if (clerkUnbanTarget.banned) {
    throw new Error('Cannot retry Clerk unban because the account is currently banned')
  }

  await invalidateAccountStateCache(clerkUnbanTarget.clerkId, 'admin_undo_ban_account_state_cache_invalidate')
  try {
    await unbanClerkUser(clerkUnbanTarget.clerkId)
    await logAdminAction({
      adminId,
      action: 'UNDO_BAN_USER_CLERK_SYNC',
      targetType: log.targetType,
      targetId: log.targetId,
      metadata: { originalActionId: log.id, clerkUserId: clerkUnbanTarget.clerkId, retry: true },
    })
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: 'undo_ban_user_clerk_sync_retry' },
      extra: { logId: log.id, adminId, targetId: log.targetId, clerkUserId: clerkUnbanTarget.clerkId },
    })
    await logAdminAction({
      adminId,
      action: 'UNDO_BAN_USER_CLERK_SYNC_FAILED',
      targetType: log.targetType,
      targetId: log.targetId,
      metadata: {
        originalActionId: log.id,
        clerkUserId: clerkUnbanTarget.clerkId,
        retry: true,
        error: sanitizeEmailOutboxError(error),
      },
    })
    throw new Error('Database undo already succeeded, but Clerk still could not be unbanned. Retry the undo or contact support.')
  }

  return true
}

async function createAdminAuditLog({
  client,
  adminId,
  action,
  targetType,
  targetId,
  reason,
  metadata = {},
}: AdminAuditLogInput & { client?: AdminAuditLogClient }): Promise<string> {
  const auditInput = {
    adminId,
    action,
    targetType,
    targetId,
    reason: sanitizeAdminAuditReason(reason) ?? undefined,
    metadata,
  }
  const log = client
    ? await appendAdminAuditLog(client, auditInput)
    : await appendAdminAuditLogForActor(auditInput)
  return log.id
}

function captureAdminAuditLogFailure(
  error: unknown,
  { adminId, action, targetType, targetId }: AdminAuditLogInput,
) {
  console.error('Audit log failed:', sanitizeEmailOutboxError(error))
  Sentry.captureException(error, {
    tags: { source: 'audit_log', action },
    extra: { adminId, targetType, targetId },
  })
}

export async function logAdminAction(input: AdminAuditLogInput): Promise<string | null> {
  try {
    return await createAdminAuditLog(input)
  } catch (error) {
    captureAdminAuditLogFailure(error, input)
    return null
  }
}

export async function logAdminActionOrThrow(input: AdminAuditLogInput & { client?: AdminAuditLogClient }): Promise<string> {
  try {
    return await createAdminAuditLog(input)
  } catch (error) {
    captureAdminAuditLogFailure(error, input)
    throw new AdminAuditLogError()
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
}): Promise<string | null> {
  return logAdminAction({
    adminId: actorId,
    action,
    targetType,
    targetId,
    reason,
    metadata: { ...metadata, actorKind: 'user' },
  })
}

export async function logUserAuditActionOrThrow({
  client,
  actorId,
  action,
  targetType,
  targetId,
  reason,
  metadata = {},
}: {
  client?: AdminAuditLogClient
  actorId: string
  action: string
  targetType: string
  targetId: string
  reason?: string
  metadata?: Record<string, unknown>
}): Promise<string> {
  return logAdminActionOrThrow({
    client,
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
  const staffClient = getOrderStaffReadClient()
  const log = await adminAuditLogStaffUndoSource(staffClient, {
    actorId: adminId,
    logId,
  })
  if (!log) throw new Error('Action not found')
  if (!isUndoableAdminAction(log.action)) throw new Error(`Action '${log.action}' cannot be undone`)
  const actorBlockReason = adminUndoActorBlockReason({
    actionAdminId: log.adminId,
    actingAdminId: adminId,
  })
  if (actorBlockReason) throw new Error(actorBlockReason)
  if (log.undone) {
    if (await retryUndoBanClerkSyncIfPending(log, adminId)) return
    throw new Error('Already undone')
  }
  const windowBlockReason = adminUndoWindowBlockReason({ createdAt: log.createdAt })
  if (windowBlockReason) throw new Error(windowBlockReason)
  const sanitizedUndoReason = sanitizeAdminAuditReason(reason)
  if (!sanitizedUndoReason) throw new Error('Undo reason is invalid')

  if (log.action === 'REMOVE_LISTING' || log.action === 'HOLD_LISTING') {
    const transition = await sellerProfileStaffListingUndoTransition(staffClient, {
      actorId: adminId,
      logId,
      reason: sanitizedUndoReason,
    })
    if (transition.action !== log.action || transition.listingId !== log.targetId) {
      throw new Error('Listing undo authority returned an unexpected target')
    }
    revalidateListingSearchCaches()
    revalidateFeaturedMakerCaches()
    return
  }

  const metadata = (log.metadata && typeof log.metadata === 'object' && !Array.isArray(log.metadata))
    ? log.metadata as Record<string, unknown>
    : {}
  const banMetadata = log.action === 'BAN_USER' ? readBanAuditMetadata(metadata) : null
  const appliedBannedAt = log.action === 'BAN_USER'
    ? dateFromMetadata(banMetadata?.appliedBannedAt ?? null)
    : null
  if (log.action === 'BAN_USER' && !appliedBannedAt) {
    throw new Error('Cannot automatically undo this ban because its audit metadata is incomplete. Use the manual unban workflow.')
  }

  let sellerRestore: { id: string; chargesEnabled: boolean; vacationMode: boolean } | null = null
  const sellerBeforeUndo = log.action === 'BAN_USER'
    ? await sellerStaffOrderabilityState(getOrderStaffReadClient(), {
        actorId: adminId,
        targetUserId: log.targetId,
      })
    : null
  if (log.action === 'BAN_USER') {
    if (banMetadata?.previousSellerProfile) {
      sellerRestore = banMetadata.previousSellerProfile
    } else if (sellerBeforeUndo?.stripeAccountId) {
      let chargesEnabled = false
      try {
        const { stripe } = await import('./stripe')
        const account = await stripe.accounts.retrieve(sellerBeforeUndo.stripeAccountId)
        chargesEnabled = Boolean(
          account.charges_enabled &&
          account.details_submitted &&
          !account.requirements?.disabled_reason
        )
      } catch (err) {
        console.error('Failed to verify Stripe account during admin undo:', sanitizeEmailOutboxError(err))
        Sentry.captureException(err, {
          level: 'warning',
          tags: { source: 'admin_undo_stripe_account_verify' },
          extra: { logId, adminId, targetId: log.targetId, sellerProfileId: sellerBeforeUndo.id },
        })
      }
      sellerRestore = {
        id: sellerBeforeUndo.id,
        chargesEnabled,
        vacationMode: !chargesEnabled,
      }
    }
  }
  const clerkUnbanTarget = log.action === 'BAN_USER'
    ? await userStaffBanTarget(staffClient, {
        actorId: adminId,
        targetId: log.targetId,
      })
    : null
  const banReviewCapability = log.action === 'BAN_USER'
    ? await mintBanReviewCapability(
        adminId,
        log.targetId,
        'BAN_REVIEW_RESTORE',
        banMetadata?.flaggedOpenOrders ?? [],
        staffClient,
      )
    : null
  const userUnbanCapability = log.action === 'BAN_USER'
    ? await mintUserStaffCapability(staffClient, {
        actorId: adminId,
        targetId: log.targetId,
        operation: 'USER_UNBAN',
        expectedBannedAt: appliedBannedAt,
      })
    : null

  await withDbUserContext(adminId, async (tx) => {
    // The source-bound authority locks the exact reviewed row, repeats the
    // actor/window/state checks, and writes the one-way undo evidence. All of
    // it rolls back if any domain restoration below fails.
    try {
      await adminAuditLogUndoClaim(tx, {
        actorId: adminId,
        reason: sanitizedUndoReason,
        source: log,
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('Already undone (concurrent request)')) {
        throw new Error('Already undone (concurrent request)')
      }
      throw error
    }

    switch (log.action) {
      case 'BAN_USER': {
        if (!banReviewCapability || !userUnbanCapability) {
          throw new Error('Ban undo authorization capability is missing')
        }
        if (banMetadata?.previousCommissionRequests.length) {
          await restoreCommissionRequestsForStaffBan(
            tx,
            banReviewCapability,
            log.targetId,
            banMetadata.previousCommissionRequests,
          )
        }
        await restoreBannedSellerOrderReviews(
          banReviewCapability,
          log.targetId,
          banMetadata?.flaggedOpenOrders ?? [],
          tx,
        )
        try {
          await userStaffUnbanApply(tx, {
            capabilityId: userUnbanCapability,
            targetId: log.targetId,
            expectedBannedAt: appliedBannedAt,
          })
        } catch (error) {
          if (error instanceof Error && error.message.includes('User ban state changed')) {
            throw new Error('User ban state changed before undo could be applied')
          }
          throw error
        }
        try {
          await transitionSellerStaffOrderability(tx, {
            targetUserId: log.targetId,
            expected: sellerBeforeUndo
              ? {
                  id: sellerBeforeUndo.id,
                  chargesEnabled: sellerBeforeUndo.chargesEnabled,
                  vacationMode: sellerBeforeUndo.vacationMode,
                }
              : null,
            next: sellerRestore
              ? {
                  chargesEnabled: sellerRestore.chargesEnabled,
                  vacationMode: sellerRestore.vacationMode,
                }
              : null,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : ''
          if (message.includes('Seller staff orderability')) {
            throw new Error('Seller profile changed before undo could be applied')
          }
          throw error
        }
        break
      }
      default:
        throw new Error(`Action '${log.action}' cannot be undone`)
    }
  })

  if (log.action === 'BAN_USER') {
    revalidatePublicSellerVisibilityCaches()
  }

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
          error: sanitizeEmailOutboxError(error),
        },
      })
      throw new Error('Database undo succeeded, but Clerk could not be unbanned. Retry the undo or contact support.')
    }
  }
}
