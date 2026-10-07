import { prisma } from './db'
import { stripe } from './stripe'
import { buildBanAuditMetadata } from './banAuditMetadata'
import { banClerkUserAndRevokeSessions, unbanClerkUser } from './clerkUserLifecycle'
import { expireOpenCheckoutSessionsForSeller } from './checkoutSessionExpiry'
import { createNotification } from './notifications'
import { NOTIFICATION_SOURCE_TYPES } from './notificationSources'
import { removeSellerCommissionInterests } from './commissionInterestCleanup'
import { revalidatePublicSellerVisibilityCaches } from './searchCache'
import { invalidateAccountStateCache } from './accountStateCache'
import { readBanAuditMetadata } from './banAuditMetadata'
import {
  flagBannedSellerOpenOrders,
  mintBanReviewCapability,
  restoreBannedSellerOrderReviews,
} from './orderBanReviewAuthority'
import { getOrderStaffReadClient } from './orderStaffReadDb'
import { sanitizeEmailOutboxError } from './emailOutboxSanitize'
import { sanitizeAdminAuditReason } from './audit'
import { repairBanUserExternalSideEffects } from './banSideEffectRepair'
import {
  mintUserStaffCapability,
  userStaffBanApply,
  userStaffBanTarget,
  userStaffUnbanApply,
} from './userStaffAccess'
import * as Sentry from '@sentry/nextjs'

const BANNED_BUYER_COMMISSION_STATUSES = ['OPEN', 'IN_PROGRESS'] as const

export class BanUserPolicyError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "BanUserPolicyError";
    this.status = status;
  }
}

export class BanUserExternalSyncError extends BanUserPolicyError {
  constructor(message: string) {
    super(message, 503);
    this.name = "BanUserExternalSyncError";
  }
}

function throwBanAuthorityPolicyError(error: unknown): never {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('User not found')) {
    throw new BanUserPolicyError('User not found', 404)
  }
  if (message.includes('Cannot ban admin accounts')) {
    throw new BanUserPolicyError('Cannot ban admin accounts')
  }
  if (message.includes('Cannot unban admin accounts')) {
    throw new BanUserPolicyError('Cannot unban admin accounts')
  }
  if (message.includes('User ban state changed')) {
    throw new BanUserPolicyError('User ban state changed. Refresh and try again.', 409)
  }
  throw error
}

async function requireBanReviewTarget(
  adminId: string,
  userId: string,
  operation: 'ban' | 'unban',
) {
  const target = await userStaffBanTarget(getOrderStaffReadClient(), {
    actorId: adminId,
    targetId: userId,
  })
  if (!target || target.deletedAt) {
    throw new BanUserPolicyError('User not found', 404)
  }
  if (target.role === 'ADMIN') {
    throw new BanUserPolicyError(`Cannot ${operation} admin accounts`)
  }
  // This preserves the existing HTTP error contract only. The staff-session
  // capability mint and consumer repeat target validation and remain the
  // source-validating authority boundary across concurrent state changes.
  return target
}

async function convergeAlreadyBannedExternalSideEffects({
  userId,
  adminId,
  clerkId,
  bannedAt,
}: {
  userId: string
  adminId: string
  clerkId: string
  bannedAt: Date | null
}) {
  const recentBanLogs = await prisma.adminAuditLog.findMany({
    where: {
      action: 'BAN_USER',
      targetType: 'USER',
      targetId: userId,
      undone: false,
    },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { id: true, metadata: true },
  })
  const matchingBanLog = recentBanLogs.find((log) => {
    const metadata = readBanAuditMetadata(log.metadata)
    return metadata.externalSyncVersion === 1
      && metadata.appliedBannedAt === bannedAt?.toISOString()
  })

  if (matchingBanLog) {
    const result = await repairBanUserExternalSideEffects({
      originalActionId: matchingBanLog.id,
      adminId,
      targetId: userId,
    })
    if (result.status === 'failed') {
      throw new BanUserExternalSyncError('User remains banned locally, but external ban side effects could not be repaired. Try again or contact support.')
    }
    return
  }

  await invalidateAccountStateCache(clerkId, 'ban_user_account_state_cache_invalidate')
  try {
    const result = await banClerkUserAndRevokeSessions(clerkId)
    await logClerkSyncResult({
      adminId,
      action: 'BAN_USER_CLERK_SYNC',
      targetId: userId,
      metadata: {
        clerkUserId: clerkId,
        revokedSessionCount: result.revokedSessionCount,
        idempotentConvergence: true,
        unmatchedHistoricalBan: true,
      },
    })
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: 'ban_user_clerk_sync' },
      extra: { userId, adminId, clerkUserId: clerkId, idempotentConvergence: true },
    })
    await logClerkSyncResult({
      adminId,
      action: 'BAN_USER_CLERK_SYNC_FAILED',
      targetId: userId,
      metadata: {
        clerkUserId: clerkId,
        idempotentConvergence: true,
        unmatchedHistoricalBan: true,
        error: sanitizeEmailOutboxError(error),
      },
    })
    throw new BanUserExternalSyncError('User remains banned locally, but Clerk still could not be updated. Try again or contact support.')
  }
}

async function logClerkSyncResult({
  adminId,
  action,
  targetId,
  originalActionId,
  metadata,
}: {
  adminId: string
  action:
    | 'BAN_USER_CLERK_SYNC'
    | 'BAN_USER_CLERK_SYNC_FAILED'
    | 'BAN_USER_CHECKOUT_SESSIONS_EXPIRED'
    | 'UNBAN_USER_CLERK_SYNC'
    | 'UNBAN_USER_CLERK_SYNC_FAILED'
  targetId: string
  originalActionId?: string
  metadata: Record<string, unknown>
}) {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminId,
        action,
        targetType: 'USER',
        targetId,
        metadata: {
          ...(originalActionId ? { originalActionId } : {}),
          ...metadata,
        } as Parameters<typeof prisma.adminAuditLog.create>[0]['data']['metadata'],
      },
    })
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: 'ban_clerk_sync_audit' },
      extra: { action, targetId },
    })
  }
}

async function convergeAlreadyUnbannedClerkTarget({
  userId,
  adminId,
  clerkId,
}: {
  userId: string
  adminId: string
  clerkId: string
}) {
  await invalidateAccountStateCache(clerkId, 'unban_user_account_state_cache_invalidate')
  try {
    await unbanClerkUser(clerkId)
    await logClerkSyncResult({
      adminId,
      action: 'UNBAN_USER_CLERK_SYNC',
      targetId: userId,
      metadata: { clerkUserId: clerkId, idempotentConvergence: true },
    })
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: 'unban_user_clerk_sync' },
      extra: { userId, adminId, clerkUserId: clerkId, idempotentConvergence: true },
    })
    await logClerkSyncResult({
      adminId,
      action: 'UNBAN_USER_CLERK_SYNC_FAILED',
      targetId: userId,
      metadata: {
        clerkUserId: clerkId,
        idempotentConvergence: true,
        error: sanitizeEmailOutboxError(error),
      },
    })
    throw new BanUserExternalSyncError("User is unbanned locally, but Clerk still could not be updated. Try the unban action again or contact support.")
  }
}

async function notifyBuyersOfBannedSellerOrders(
  orders: Array<{ id: string; buyerId: string | null }>,
  banAuditLogId: string,
  bannedSellerUserId: string,
) {
  const notifiableOrders = orders.filter((order): order is { id: string; buyerId: string } => Boolean(order.buyerId))
  const results = await Promise.allSettled(
    notifiableOrders.map((order) =>
      createNotification({
        userId: order.buyerId,
        type: 'ACCOUNT_WARNING',
        title: 'Order under support review',
        body: 'The maker is currently unavailable. Grainline staff will review the order and next steps.',
        link: `/dashboard/orders/${order.id}`,
        sourceType: NOTIFICATION_SOURCE_TYPES.BANNED_SELLER_ORDER,
        sourceId: `${banAuditLogId}:${order.id}`,
        relatedUserId: bannedSellerUserId,
      }),
    ),
  )

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') return
    Sentry.captureException(result.reason, {
      tags: { source: 'ban_user_buyer_notification' },
      extra: {
        orderId: notifiableOrders[index]?.id,
        buyerId: notifiableOrders[index]?.buyerId,
      },
    })
  })
}

function revalidateAccountStateSearchCaches(source: string, userId: string) {
  try {
    revalidatePublicSellerVisibilityCaches()
  } catch (error) {
    Sentry.captureException(error, {
      level: 'warning',
      tags: { source },
      extra: { userId },
    })
  }
}

export async function banUser({ userId, adminId, reason }: {
  userId: string; adminId: string; reason: string
}) {
  const reviewedTarget = await requireBanReviewTarget(adminId, userId, 'ban')
  if (reviewedTarget.banned) {
    await convergeAlreadyBannedExternalSideEffects({
      userId,
      adminId,
      clerkId: reviewedTarget.clerkId,
      bannedAt: reviewedTarget.bannedAt,
    })
    return
  }
  const staffClient = getOrderStaffReadClient()
  const userBanCapability = await mintUserStaffCapability(staffClient, {
    actorId: adminId,
    targetId: userId,
    operation: 'USER_BAN',
    expectedBannedAt: null,
  })
  const banReviewCapability = await mintBanReviewCapability(
    adminId,
    userId,
    'BAN_REVIEW_FLAG',
    null,
    staffClient,
  )
  const clerkSync = await prisma.$transaction(async (tx) => {
    const bannedAt = new Date()
    let target: Awaited<ReturnType<typeof userStaffBanApply>>
    try {
      target = await userStaffBanApply(tx, {
        capabilityId: userBanCapability,
        targetId: userId,
        bannedAt,
        reason,
      })
    } catch (error) {
      throwBanAuthorityPolicyError(error)
    }
    const [sellerProfile, commissionRequests] = await Promise.all([
      tx.sellerProfile.findUnique({
        where: { userId },
        select: { id: true, chargesEnabled: true, vacationMode: true, stripeAccountId: true },
      }),
      tx.commissionRequest.findMany({
        where: { buyerId: userId, status: { in: [...BANNED_BUYER_COMMISSION_STATUSES] } },
        select: { id: true, status: true },
      }),
    ])
    await tx.sellerProfile.updateMany({
      where: { userId },
      data: { chargesEnabled: false, vacationMode: true }
    })
    let removedCommissionInterestRequestIds: string[] = []
    if (sellerProfile) {
      const cleanup = await removeSellerCommissionInterests(tx, sellerProfile.id)
      removedCommissionInterestRequestIds = cleanup.commissionRequestIds
    }
    await tx.commissionRequest.updateMany({
      where: { buyerId: userId, status: { in: [...BANNED_BUYER_COMMISSION_STATUSES] } },
      data: { status: 'CLOSED' }
    })
    const flaggedOpenOrders = await flagBannedSellerOpenOrders(
      banReviewCapability,
      userId,
      tx,
    )
    const banAuditLog = await tx.adminAuditLog.create({
      data: {
        adminId,
        action: 'BAN_USER',
        targetType: 'USER',
        targetId: userId,
        reason: sanitizeAdminAuditReason(reason),
        metadata: {
          ...buildBanAuditMetadata({
            sellerProfile,
            commissionRequests,
            openOrderSnapshots: flaggedOpenOrders,
            appliedBannedAt: bannedAt,
          }),
          removedCommissionInterestRequestIds,
        },
      }
    })
    return {
      clerkId: target.clerkId,
      banAuditLogId: banAuditLog.id,
      sellerCheckoutExpiry: sellerProfile?.stripeAccountId
        ? { sellerId: sellerProfile.id, stripeAccountId: sellerProfile.stripeAccountId }
        : null,
      flaggedOpenOrders: flaggedOpenOrders.map((order) => ({
        id: order.id,
        buyerId: order.buyerId,
      })),
    }
  })

  await invalidateAccountStateCache(clerkSync.clerkId, 'ban_user_account_state_cache_invalidate')
  revalidateAccountStateSearchCaches('ban_user_search_cache_revalidate', userId)

  if (clerkSync.sellerCheckoutExpiry) {
    try {
      const expiryResult = await expireOpenCheckoutSessionsForSeller({
        ...clerkSync.sellerCheckoutExpiry,
        source: 'ban_user',
      })
      await logClerkSyncResult({
        adminId,
        action: 'BAN_USER_CHECKOUT_SESSIONS_EXPIRED',
        targetId: userId,
        originalActionId: clerkSync.banAuditLogId,
        metadata: {
          ...clerkSync.sellerCheckoutExpiry,
          ...expiryResult,
        },
      })
    } catch (error) {
      Sentry.captureException(error, {
        tags: { source: 'ban_user_checkout_session_expiry' },
        extra: { userId, adminId, ...clerkSync.sellerCheckoutExpiry },
      })
    }
  }

  await notifyBuyersOfBannedSellerOrders(
    clerkSync.flaggedOpenOrders,
    clerkSync.banAuditLogId,
    userId,
  )

  try {
    const result = await banClerkUserAndRevokeSessions(clerkSync.clerkId)
    await logClerkSyncResult({
      adminId,
      action: 'BAN_USER_CLERK_SYNC',
      targetId: userId,
      originalActionId: clerkSync.banAuditLogId,
      metadata: {
        clerkUserId: clerkSync.clerkId,
        revokedSessionCount: result.revokedSessionCount,
      },
    })
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: 'ban_user_clerk_sync' },
      extra: { userId, adminId, clerkUserId: clerkSync.clerkId },
    })
    await logClerkSyncResult({
      adminId,
      action: 'BAN_USER_CLERK_SYNC_FAILED',
      targetId: userId,
      originalActionId: clerkSync.banAuditLogId,
      metadata: {
        clerkUserId: clerkSync.clerkId,
        error: sanitizeEmailOutboxError(error),
      },
    })
    throw new BanUserExternalSyncError("User was banned locally, but active Clerk sessions could not be revoked. Try the ban action again or contact support.")
  }
}

export async function unbanUser({ userId, adminId, reason }: {
  userId: string; adminId: string; reason: string
}) {
  const target = await requireBanReviewTarget(adminId, userId, 'unban')
  if (!target.banned) {
    await convergeAlreadyUnbannedClerkTarget({
      userId,
      adminId,
      clerkId: target.clerkId,
    })
    return { sellerRestoreWarning: null }
  }
  const seller = await prisma.sellerProfile.findUnique({
    where: { userId }, select: { id: true, stripeAccountId: true }
  })
  let sellerRestore: { id: string; chargesEnabled: boolean; vacationMode: boolean } | null = null
  let sellerRestoreWarning: string | null = null
  let sellerRestoreError: string | null = null
  if (seller?.stripeAccountId) {
    try {
      const account = await stripe.accounts.retrieve(seller.stripeAccountId)
      const chargesEnabled = Boolean(
        account.charges_enabled &&
        account.details_submitted &&
        !account.requirements?.disabled_reason
      )
      sellerRestore = { id: seller.id, chargesEnabled, vacationMode: !chargesEnabled }
    } catch (err) {
      sellerRestoreWarning = "Stripe account could not be verified; seller shop settings were left unchanged."
      sellerRestoreError = sanitizeEmailOutboxError(err)
      Sentry.captureException(err, {
        tags: { source: 'unban_user_stripe_restore' },
        extra: { userId, adminId, sellerProfileId: seller.id, stripeAccountId: seller.stripeAccountId },
      })
    }
  }
  const latestBanForCapability = await prisma.adminAuditLog.findFirst({
    where: { action: 'BAN_USER', targetType: 'USER', targetId: userId },
    orderBy: { createdAt: 'desc' },
    select: { metadata: true },
  })
  const capabilityBanMetadata = readBanAuditMetadata(latestBanForCapability?.metadata)
  const staffClient = getOrderStaffReadClient()
  const userUnbanCapability = await mintUserStaffCapability(staffClient, {
    actorId: adminId,
    targetId: userId,
    operation: 'USER_UNBAN',
    expectedBannedAt: target.bannedAt,
  })
  const banReviewCapability = await mintBanReviewCapability(
    adminId,
    userId,
    'BAN_REVIEW_RESTORE',
    capabilityBanMetadata.flaggedOpenOrders,
    staffClient,
  )
  const clerkSync = await prisma.$transaction(async (tx) => {
    const restoredFlaggedOrderReviews = await restoreBannedSellerOrderReviews(
      banReviewCapability,
      userId,
      capabilityBanMetadata.flaggedOpenOrders,
      tx,
    )
    let previousUser: Awaited<ReturnType<typeof userStaffUnbanApply>>
    try {
      previousUser = await userStaffUnbanApply(tx, {
        capabilityId: userUnbanCapability,
        targetId: userId,
        expectedBannedAt: target.bannedAt,
      })
    } catch (error) {
      throwBanAuthorityPolicyError(error)
    }
    const previousSellerProfile = await tx.sellerProfile.findUnique({
      where: { userId },
      select: { id: true, chargesEnabled: true, vacationMode: true },
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
    const unbanAuditLog = await tx.adminAuditLog.create({
      data: {
        adminId,
        action: 'UNBAN_USER',
        targetType: 'USER',
        targetId: userId,
        reason: sanitizeAdminAuditReason(reason),
        metadata: {
          previousUser: previousUser
            ? {
                banned: previousUser.banned,
                bannedAt: previousUser.bannedAt?.toISOString() ?? null,
                banReason: previousUser.banReason,
                bannedBy: previousUser.bannedBy,
              }
            : null,
          previousSellerProfile,
          restoredFlaggedOrderReviews,
          restoredSellerProfile: sellerRestore,
          sellerRestoreWarning,
          sellerRestoreError,
        },
      }
    })
    return {
      clerkId: previousUser.clerkId,
      sellerRestoreWarning,
      unbanAuditLogId: unbanAuditLog.id,
    }
  })

  await invalidateAccountStateCache(clerkSync.clerkId, 'unban_user_account_state_cache_invalidate')
  revalidateAccountStateSearchCaches('unban_user_search_cache_revalidate', userId)

  try {
    await unbanClerkUser(clerkSync.clerkId)
    await logClerkSyncResult({
      adminId,
      action: 'UNBAN_USER_CLERK_SYNC',
      targetId: userId,
      originalActionId: clerkSync.unbanAuditLogId,
      metadata: { clerkUserId: clerkSync.clerkId },
    })
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: 'unban_user_clerk_sync' },
      extra: { userId, adminId, clerkUserId: clerkSync.clerkId },
    })
    await logClerkSyncResult({
      adminId,
      action: 'UNBAN_USER_CLERK_SYNC_FAILED',
      targetId: userId,
      originalActionId: clerkSync.unbanAuditLogId,
      metadata: {
        clerkUserId: clerkSync.clerkId,
        error: sanitizeEmailOutboxError(error),
      },
    })
    throw new BanUserExternalSyncError("User was unbanned locally, but Clerk still could not be updated. Try the unban action again or contact support.")
  }

  return {
    sellerRestoreWarning: clerkSync.sellerRestoreWarning,
  }
}
