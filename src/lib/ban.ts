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
  restoreBannedSellerOrderReviews,
} from './orderBanReviewAuthority'
import { sanitizeEmailOutboxError } from './emailOutboxSanitize'
import { sanitizeAdminAuditReason } from './audit'
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
  const clerkSync = await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { role: true, clerkId: true },
    });
    if (!target) throw new BanUserPolicyError("User not found", 404);
    if (target.role === "ADMIN") throw new BanUserPolicyError("Cannot ban admin accounts");

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
    const bannedAt = new Date()
    const banResult = await tx.user.updateMany({
      where: { id: userId, role: { not: "ADMIN" } },
      data: { banned: true, bannedAt, banReason: reason, bannedBy: adminId }
    })
    if (banResult.count !== 1) throw new BanUserPolicyError("Cannot ban admin accounts");
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
    const flaggedOpenOrders = await flagBannedSellerOpenOrders(adminId, userId, tx)
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
  const clerkSync = await prisma.$transaction(async (tx) => {
    const [previousUser, previousSellerProfile, latestBanLog] = await Promise.all([
      tx.user.findUnique({
        where: { id: userId },
        select: { clerkId: true, banned: true, bannedAt: true, banReason: true, bannedBy: true },
      }),
      tx.sellerProfile.findUnique({
        where: { userId },
        select: { id: true, chargesEnabled: true, vacationMode: true },
      }),
      tx.adminAuditLog.findFirst({
        where: { action: 'BAN_USER', targetType: 'USER', targetId: userId },
        orderBy: { createdAt: 'desc' },
        select: { metadata: true },
      }),
    ])
    if (!previousUser) throw new BanUserPolicyError("User not found", 404)
    const banMetadata = readBanAuditMetadata(latestBanLog?.metadata)
    const restoredFlaggedOrderReviews = await restoreBannedSellerOrderReviews(
      adminId,
      userId,
      banMetadata.flaggedOpenOrders,
      tx,
    )
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
    return { clerkId: previousUser.clerkId, sellerRestoreWarning }
  })

  await invalidateAccountStateCache(clerkSync.clerkId, 'unban_user_account_state_cache_invalidate')
  revalidateAccountStateSearchCaches('unban_user_search_cache_revalidate', userId)

  try {
    await unbanClerkUser(clerkSync.clerkId)
    await logClerkSyncResult({
      adminId,
      action: 'UNBAN_USER_CLERK_SYNC',
      targetId: userId,
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
