import { prisma } from './db'
import { stripe } from './stripe'
import { Prisma } from '@prisma/client'
import { buildBanAuditMetadata } from './banAuditMetadata'
import { banClerkUserAndRevokeSessions, unbanClerkUser } from './clerkUserLifecycle'
import { expireOpenCheckoutSessionsForSeller } from './checkoutSessionExpiry'
import { createNotification } from './notifications'
import { blockingRefundLedgerWhere } from './refundRouteState'
import { removeSellerCommissionInterests } from './commissionInterestCleanup'
import { revalidatePublicSellerVisibilityCaches } from './searchCache'
import { invalidateAccountStateCache } from './accountStateCache'
import {
  appendBannedSellerReviewNote,
  restoreOrderReviewStateAfterBan,
} from './banOrderReviewState'
import { readBanAuditMetadata, type BanOpenOrderSnapshot } from './banAuditMetadata'
import { sanitizeEmailOutboxError } from './emailOutboxSanitize'
import { sanitizeAdminAuditReason } from './audit'
import * as Sentry from '@sentry/nextjs'

const OPEN_SELLER_ORDER_STATUSES = ['PENDING', 'READY_FOR_PICKUP', 'SHIPPED'] as const
const BANNED_BUYER_COMMISSION_STATUSES = ['OPEN', 'IN_PROGRESS'] as const
const BAN_ORDER_REVIEW_UPDATE_CHUNK_SIZE = 100

type FlaggedOpenOrderForBan = {
  id: string
  previousReviewNeeded: boolean
  previousReviewNote: string | null
  reviewNote: string
}

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

async function restoreBannedSellerOrderReviewState(
  tx: Pick<Prisma.TransactionClient, 'order'>,
  snapshots: BanOpenOrderSnapshot[],
) {
  if (snapshots.length === 0) return 0
  const currentOrders = await tx.order.findMany({
    where: { id: { in: snapshots.map((snapshot) => snapshot.id) } },
    select: { id: true, reviewNeeded: true, reviewNote: true },
  })
  const currentById = new Map(currentOrders.map((order) => [order.id, order]))

  let restored = 0
  for (const snapshot of snapshots) {
    const current = currentById.get(snapshot.id)
    if (!current) continue
    const restoration = restoreOrderReviewStateAfterBan({
      currentReviewNeeded: current.reviewNeeded,
      currentReviewNote: current.reviewNote,
      snapshot,
    })
    if (!restoration) continue
    const updated = await tx.order.updateMany({
      where: {
        id: snapshot.id,
        reviewNeeded: current.reviewNeeded,
        reviewNote: current.reviewNote,
      },
      data: restoration,
    })
    restored += updated.count
  }
  return restored
}

async function flagBannedSellerOpenOrders(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  flaggedOpenOrders: FlaggedOpenOrderForBan[],
) {
  let updatedCount = 0
  for (let index = 0; index < flaggedOpenOrders.length; index += BAN_ORDER_REVIEW_UPDATE_CHUNK_SIZE) {
    const chunk = flaggedOpenOrders.slice(index, index + BAN_ORDER_REVIEW_UPDATE_CHUNK_SIZE)
    const rows = chunk.map((order) => Prisma.sql`(
      ${order.id}::text,
      ${order.reviewNote}::text,
      ${order.previousReviewNote}::text,
      ${order.previousReviewNeeded}::boolean
    )`)
    const updated = await tx.$executeRaw`
      UPDATE "Order" AS o
      SET "reviewNeeded" = true,
          "reviewNote" = data."reviewNote"
      FROM (VALUES ${Prisma.join(rows)}) AS data("id", "reviewNote", "previousReviewNote", "previousReviewNeeded")
      WHERE o."id" = data."id"
        AND o."reviewNeeded" = data."previousReviewNeeded"
        AND o."reviewNote" IS NOT DISTINCT FROM data."previousReviewNote"
    `
    updatedCount += Number(updated)
  }
  if (updatedCount !== flaggedOpenOrders.length) {
    throw new BanUserPolicyError("Open order review state changed while banning user. Refresh and try again.", 409)
  }
  return updatedCount
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
    const openSellerOrders = sellerProfile
      ? await tx.order.findMany({
          where: {
            fulfillmentStatus: { in: [...OPEN_SELLER_ORDER_STATUSES] },
            sellerRefundId: null,
            paymentEvents: { none: blockingRefundLedgerWhere() },
            items: {
              some: { listing: { sellerId: sellerProfile.id } },
              every: { listing: { sellerId: sellerProfile.id } },
            },
          },
          select: {
            id: true,
            buyerId: true,
            reviewNeeded: true,
            reviewNote: true,
          },
        })
      : []
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
    const flaggedOpenOrders = openSellerOrders.map((order) => {
      const reviewNoteState = appendBannedSellerReviewNote(order.reviewNote)
      return {
        id: order.id,
        buyerId: order.buyerId,
        previousReviewNeeded: order.reviewNeeded,
        previousReviewNote: order.reviewNote,
        reviewNote: reviewNoteState.reviewNote,
        addedReviewNote: reviewNoteState.addedReviewNote,
      }
    })
    await tx.commissionRequest.updateMany({
      where: { buyerId: userId, status: { in: [...BANNED_BUYER_COMMISSION_STATUSES] } },
      data: { status: 'CLOSED' }
    })
    await flagBannedSellerOpenOrders(tx, flaggedOpenOrders)
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
            openOrders: flaggedOpenOrders,
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

  await notifyBuyersOfBannedSellerOrders(clerkSync.flaggedOpenOrders)

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
    const restoredFlaggedOrderReviews = await restoreBannedSellerOrderReviewState(
      tx,
      banMetadata.flaggedOpenOrders,
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
