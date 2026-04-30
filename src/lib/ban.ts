import { prisma } from './db'
import { stripe } from './stripe'
import { buildBanAuditMetadata } from './banAuditMetadata'
import { banClerkUserAndRevokeSessions, unbanClerkUser } from './clerkUserLifecycle'
import { expireOpenCheckoutSessionsForSeller } from './checkoutSessionExpiry'
import { createNotification } from './notifications'
import { blockingRefundLedgerWhere } from './refundRouteState'
import { truncateText } from './sanitize'
import * as Sentry from '@sentry/nextjs'

const OPEN_SELLER_ORDER_STATUSES = ['PENDING', 'READY_FOR_PICKUP', 'SHIPPED'] as const
const BANNED_SELLER_REVIEW_NOTE = 'Seller account was banned after payment. Staff must review fulfillment and refund options before further action.'

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
  metadata: Record<string, unknown>
}) {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminId,
        action,
        targetType: 'USER',
        targetId,
        metadata: metadata as Parameters<typeof prisma.adminAuditLog.create>[0]['data']['metadata'],
      },
    })
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: 'ban_clerk_sync_audit' },
      extra: { action, targetId },
    })
  }
}

function appendBanReviewNote(existing: string | null) {
  if (!existing) return BANNED_SELLER_REVIEW_NOTE
  if (existing.includes(BANNED_SELLER_REVIEW_NOTE)) return existing
  return truncateText(`${existing}\n\n${BANNED_SELLER_REVIEW_NOTE}`, 5000)
}

async function notifyBuyersOfBannedSellerOrders(
  orders: Array<{ id: string; buyerId: string | null }>,
) {
  await Promise.all(
    orders
      .filter((order): order is { id: string; buyerId: string } => Boolean(order.buyerId))
      .map((order) =>
        createNotification({
          userId: order.buyerId,
          type: 'ACCOUNT_WARNING',
          title: 'Order under support review',
          body: 'The maker is currently unavailable. Grainline staff will review the order and next steps.',
          link: `/dashboard/orders/${order.id}`,
        }),
      ),
  )
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
        where: { buyerId: userId, status: 'OPEN' },
        select: { id: true, status: true },
      }),
    ])
    const openSellerOrders = sellerProfile
      ? await tx.order.findMany({
          where: {
            fulfillmentStatus: { in: [...OPEN_SELLER_ORDER_STATUSES] },
            sellerRefundId: null,
            paymentEvents: { none: blockingRefundLedgerWhere() },
            items: { some: { listing: { sellerId: sellerProfile.id } } },
          },
          select: {
            id: true,
            buyerId: true,
            reviewNeeded: true,
            reviewNote: true,
          },
        })
      : []
    const banResult = await tx.user.updateMany({
      where: { id: userId, role: { not: "ADMIN" } },
      data: { banned: true, bannedAt: new Date(), banReason: reason, bannedBy: adminId }
    })
    if (banResult.count !== 1) throw new BanUserPolicyError("Cannot ban admin accounts");
    await tx.sellerProfile.updateMany({
      where: { userId },
      data: { chargesEnabled: false, vacationMode: true }
    })
    await tx.commissionRequest.updateMany({
      where: { buyerId: userId, status: 'OPEN' },
      data: { status: 'CLOSED' }
    })
    for (const order of openSellerOrders) {
      await tx.order.update({
        where: { id: order.id },
        data: {
          reviewNeeded: true,
          reviewNote: appendBanReviewNote(order.reviewNote),
        },
      })
    }
    await tx.adminAuditLog.create({
      data: {
        adminId,
        action: 'BAN_USER',
        targetType: 'USER',
        targetId: userId,
        reason,
        metadata: buildBanAuditMetadata({
          sellerProfile,
          commissionRequests,
          openOrders: openSellerOrders.map((order) => ({
            id: order.id,
            buyerId: order.buyerId,
            previousReviewNeeded: order.reviewNeeded,
            previousReviewNote: order.reviewNote,
          })),
        }),
      }
    })
    return {
      clerkId: target.clerkId,
      sellerCheckoutExpiry: sellerProfile?.stripeAccountId
        ? { sellerId: sellerProfile.id, stripeAccountId: sellerProfile.stripeAccountId }
        : null,
      flaggedOpenOrders: openSellerOrders.map((order) => ({
        id: order.id,
        buyerId: order.buyerId,
      })),
    }
  })

  if (clerkSync.sellerCheckoutExpiry) {
    const expiryResult = await expireOpenCheckoutSessionsForSeller({
      ...clerkSync.sellerCheckoutExpiry,
      source: 'ban_user',
    })
    await logClerkSyncResult({
      adminId,
      action: 'BAN_USER_CHECKOUT_SESSIONS_EXPIRED',
      targetId: userId,
      metadata: {
        ...clerkSync.sellerCheckoutExpiry,
        ...expiryResult,
      },
    })
  }

  await notifyBuyersOfBannedSellerOrders(clerkSync.flaggedOpenOrders)

  try {
    const result = await banClerkUserAndRevokeSessions(clerkSync.clerkId)
    await logClerkSyncResult({
      adminId,
      action: 'BAN_USER_CLERK_SYNC',
      targetId: userId,
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
      metadata: {
        clerkUserId: clerkSync.clerkId,
        error: error instanceof Error ? error.message : String(error),
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
      sellerRestoreError = err instanceof Error ? err.message : String(err)
      Sentry.captureException(err, {
        tags: { source: 'unban_user_stripe_restore' },
        extra: { userId, adminId, sellerProfileId: seller.id, stripeAccountId: seller.stripeAccountId },
      })
    }
  }
  const clerkSync = await prisma.$transaction(async (tx) => {
    const [previousUser, previousSellerProfile] = await Promise.all([
      tx.user.findUnique({
        where: { id: userId },
        select: { clerkId: true, banned: true, bannedAt: true, banReason: true, bannedBy: true },
      }),
      tx.sellerProfile.findUnique({
        where: { userId },
        select: { id: true, chargesEnabled: true, vacationMode: true },
      }),
    ])
    if (!previousUser) throw new BanUserPolicyError("User not found", 404)
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
        reason,
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
          restoredSellerProfile: sellerRestore,
          sellerRestoreWarning,
          sellerRestoreError,
        },
      }
    })
    return { clerkId: previousUser.clerkId, sellerRestoreWarning }
  })

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
        error: error instanceof Error ? error.message : String(error),
      },
    })
    throw new BanUserExternalSyncError("User was unbanned locally, but Clerk still could not be updated. Try the unban action again or contact support.")
  }

  return {
    sellerRestoreWarning: clerkSync.sellerRestoreWarning,
  }
}
