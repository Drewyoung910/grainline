import { auth } from '@clerk/nextjs/server'
import * as Sentry from '@sentry/nextjs'
import { after, NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { logAdminActionOrThrow } from '@/lib/audit'
import { createNotification } from '@/lib/notifications'
import { NOTIFICATION_SOURCE_TYPES } from '@/lib/notificationSources'
import { sendCustomOrderReadyLink } from '@/lib/customOrderReadyLink'
import { maybeGrantFoundingMaker } from '@/lib/foundingMaker'
import { syncGuildMemberListingThreshold } from '@/lib/guildListingThreshold'
import { adminActionRatelimit, rateLimitResponse, safeRateLimit } from '@/lib/ratelimit'
import { publicListingPath } from '@/lib/publicPaths'
import { revalidateFeaturedMakerCaches, revalidateListingSearchCaches } from '@/lib/searchCache'
import { fanOutListingToFollowers } from '@/lib/followerListingNotifications'
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from '@/lib/requestBody'
import { privateJson, privateResponse } from '@/lib/privateResponse'
import { HTTP_STATUS } from '@/lib/httpStatus'
import { sanitizeText, truncateText } from '@/lib/sanitize'
import { z } from 'zod'

const ReviewActionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  reason: z.string().max(500).nullish(),
})
const ADMIN_LISTING_REVIEW_BODY_MAX_BYTES = 16 * 1024

function sellerUnavailableReason(seller: {
  chargesEnabled: boolean
  vacationMode: boolean
  user: { banned: boolean; deletedAt: Date | null } | null
}) {
  if (!seller.user || seller.user.deletedAt) return 'Seller account is unavailable.'
  if (seller.user.banned) return 'Seller account is suspended.'
  if (!seller.chargesEnabled) return 'Seller payouts are not connected.'
  if (seller.vacationMode) return 'Seller is in vacation mode.'
  return null
}

async function syncGuildThresholdAfterAdminReview(listingId: string, sellerId: string, source: string) {
  try {
    await syncGuildMemberListingThreshold(sellerId)
  } catch (error) {
    Sentry.captureException(error, {
      level: 'warning',
      tags: { source },
      extra: { listingId, sellerId },
    })
  }
}

function queueAdminApprovedListingFollowerFanout(listing: {
  id: string
  title: string
  priceCents: number
  currency: string | null
  sellerId: string
  seller: { displayName: string | null }
}) {
  after(async () => {
    try {
      await fanOutListingToFollowers({
        sellerProfileId: listing.sellerId,
        sellerDisplayName: listing.seller.displayName,
        listing,
        emailDedupKey: (followerId) => `admin-approved-listing:${listing.id}:${followerId}`,
      })
    } catch (error) {
      Sentry.captureException(error, {
        level: 'warning',
        tags: { source: 'admin_listing_review_follower_fanout' },
        extra: { listingId: listing.id, sellerProfileId: listing.sellerId },
      })
    }
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return privateJson({ error: 'Unauthorized' }, { status: HTTP_STATUS.UNAUTHORIZED })
  const { success, reset } = await safeRateLimit(adminActionRatelimit, userId)
  if (!success) return privateResponse(rateLimitResponse(reset, 'Too many admin actions.'))
  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true }
  })
  if (!admin || admin.banned || admin.deletedAt || (admin.role !== 'ADMIN' && admin.role !== 'EMPLOYEE')) {
    return privateJson({ error: 'Forbidden' }, { status: HTTP_STATUS.FORBIDDEN })
  }
  const { id } = await params
  let body
  try {
    body = ReviewActionSchema.parse(await readBoundedJson(request, ADMIN_LISTING_REVIEW_BODY_MAX_BYTES))
  } catch (e) {
    if (isRequestBodyTooLargeError(e)) {
      return privateJson({ error: 'Request body too large' }, { status: HTTP_STATUS.PAYLOAD_TOO_LARGE })
    }
    if (isInvalidJsonBodyError(e)) {
      return privateJson({ error: 'Invalid JSON' }, { status: HTTP_STATUS.BAD_REQUEST })
    }
    if (e instanceof z.ZodError) {
      return privateJson({ error: 'Invalid input', details: e.issues }, { status: HTTP_STATUS.BAD_REQUEST })
    }
    throw e
  }
  const { action, reason } = body
  const sanitizedReason = truncateText(sanitizeText(reason ?? ''), 500).trim()

  const listing = await prisma.listing.findUnique({
    where: { id },
    include: {
      seller: {
        select: {
          userId: true,
          displayName: true,
          chargesEnabled: true,
          vacationMode: true,
          user: { select: { banned: true, deletedAt: true } },
        },
      },
    },
  })
  if (!listing) return privateJson({ error: 'Not found' }, { status: HTTP_STATUS.NOT_FOUND })

  if (action === 'approve') {
    const unavailableReason = sellerUnavailableReason(listing.seller)
    if (unavailableReason) {
      return privateJson({ error: unavailableReason }, { status: HTTP_STATUS.CONFLICT })
    }

    const approved = await prisma.$transaction(async (tx) => {
      const updated = await tx.listing.updateMany({
        where: {
          id,
          status: 'PENDING_REVIEW',
          seller: {
            chargesEnabled: true,
            vacationMode: false,
            user: { banned: false, deletedAt: null },
          },
        },
        data: { status: 'ACTIVE', reviewedByAdmin: true, reviewedAt: new Date(), rejectionReason: null }
      })
      if (updated.count === 0) {
        return { count: 0, finalStatus: null as 'ACTIVE' | 'SOLD_OUT' | null, auditLogId: null as string | null }
      }
      const soldOutCount = await tx.$executeRaw`
        UPDATE "Listing"
        SET status = 'SOLD_OUT'
        WHERE id = ${id}
          AND "sellerId" = ${listing.sellerId}
          AND "listingType" = 'IN_STOCK'
          AND COALESCE("stockQuantity", 0) <= 0
          AND status = 'ACTIVE'
      `
      const finalStatus = Number(soldOutCount) > 0 ? 'SOLD_OUT' : 'ACTIVE'
      const auditLogId = await logAdminActionOrThrow({
        client: tx,
        adminId: admin.id,
        action: 'APPROVE_LISTING',
        targetType: 'LISTING',
        targetId: id,
        reason: sanitizedReason || 'Approved',
        metadata: { finalStatus },
      })
      return {
        count: updated.count,
        finalStatus,
        auditLogId,
      }
    })
    if (approved.count === 0) {
      const currentListing = await prisma.listing.findUnique({
        where: { id },
        include: {
          seller: {
            select: {
              userId: true,
              displayName: true,
              chargesEnabled: true,
              vacationMode: true,
              user: { select: { banned: true, deletedAt: true } },
            },
          },
        },
      })
      if (!currentListing) return privateJson({ error: 'Not found' }, { status: HTTP_STATUS.NOT_FOUND })
      const currentUnavailableReason = sellerUnavailableReason(currentListing.seller)
      if (currentListing.status === 'PENDING_REVIEW' && currentUnavailableReason) {
        return privateJson({ error: currentUnavailableReason }, { status: HTTP_STATUS.CONFLICT })
      }
      if (
        currentListing.status === 'ACTIVE' &&
        !currentUnavailableReason &&
        currentListing.customOrderConversationId &&
        currentListing.reservedForUserId
      ) {
        await sendCustomOrderReadyLink({
          listingId: currentListing.id,
        })
      }
      return privateJson({ ok: true, skipped: true, reason: 'Listing is no longer pending review.' })
    }
    if (!approved.auditLogId || !approved.finalStatus) {
      throw new Error('Approved listing transition did not return its audit authority')
    }
    revalidateListingSearchCaches()
    revalidateFeaturedMakerCaches()
    await syncGuildThresholdAfterAdminReview(id, listing.sellerId, 'admin_listing_approve_guild_threshold')
    if (approved.finalStatus === 'ACTIVE') {
      // First active listing for this seller might earn the Founding Maker badge.
      try {
        await maybeGrantFoundingMaker(listing.sellerId)
      } catch (error) {
        Sentry.captureException(error, {
          level: 'warning',
          tags: { source: 'admin_listing_review_founding_maker' },
          extra: { listingId: id, sellerId: listing.sellerId },
        })
      }
      queueAdminApprovedListingFollowerFanout(listing)
      if (listing.customOrderConversationId && listing.reservedForUserId) {
        await sendCustomOrderReadyLink({
          listingId: listing.id,
        })
      }
    }
    const notificationBody = approved.finalStatus === 'SOLD_OUT'
      ? `Your listing "${listing.title}" has been approved. Add stock to make it available to buyers.`
      : `Your listing "${listing.title}" has been approved and is now live!`
    await createNotification({
      userId: listing.seller.userId,
      type: 'LISTING_APPROVED',
      title: 'Listing approved',
      body: notificationBody,
      link: publicListingPath(id, listing.title),
      sourceType: NOTIFICATION_SOURCE_TYPES.LISTING_ADMIN_REVIEW,
      sourceId: approved.auditLogId,
    }).catch((error) => {
      Sentry.captureException(error, {
        level: 'warning',
        tags: { source: 'admin_listing_review_notification' },
        extra: { listingId: id, sellerUserId: listing.seller.userId, action },
      })
    })
  } else if (action === 'reject') {
    if (!sanitizedReason) return privateJson({ error: 'Reason required for rejection' }, { status: HTTP_STATUS.BAD_REQUEST })
    const rejected = await prisma.$transaction(async (tx) => {
      const updated = await tx.listing.updateMany({
        where: { id, status: 'PENDING_REVIEW' },
        data: { status: 'REJECTED', reviewedByAdmin: true, reviewedAt: new Date(), rejectionReason: sanitizedReason }
      })
      if (updated.count === 0) return { count: 0, auditLogId: null as string | null }
      const auditLogId = await logAdminActionOrThrow({
        client: tx,
        adminId: admin.id,
        action: 'REJECT_LISTING',
        targetType: 'LISTING',
        targetId: id,
        reason: sanitizedReason,
      })
      return { count: updated.count, auditLogId }
    })
    if (rejected.count === 0) {
      return privateJson({ ok: true, skipped: true, reason: 'Listing is no longer pending review.' })
    }
    if (!rejected.auditLogId) {
      throw new Error('Rejected listing transition did not return its audit authority')
    }
    revalidateListingSearchCaches()
    revalidateFeaturedMakerCaches()
    await syncGuildThresholdAfterAdminReview(id, listing.sellerId, 'admin_listing_reject_guild_threshold')
    await createNotification({
      userId: listing.seller.userId,
      type: 'LISTING_REJECTED',
      title: 'Listing needs changes',
      body: `Your listing "${listing.title}" was not approved. Reason: ${sanitizedReason}. Please edit and resubmit.`,
      link: `/dashboard/listings/${id}/edit`,
      sourceType: NOTIFICATION_SOURCE_TYPES.LISTING_ADMIN_REVIEW,
      sourceId: rejected.auditLogId,
    }).catch((error) => {
      Sentry.captureException(error, {
        level: 'warning',
        tags: { source: 'admin_listing_review_notification' },
        extra: { listingId: id, sellerUserId: listing.seller.userId, action },
      })
    })
  } else {
    return privateJson({ error: 'Invalid action' }, { status: HTTP_STATUS.BAD_REQUEST })
  }

  return privateJson({ ok: true })
}
