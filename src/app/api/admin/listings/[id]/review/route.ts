import { auth } from '@clerk/nextjs/server'
import * as Sentry from '@sentry/nextjs'
import { after, NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { userClerkGate } from '@/lib/userIdentityAccess'
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
import { getOrderStaffReadClient } from '@/lib/orderStaffReadDb'
import { sellerProfileStaffListingReviewTransition } from '@/lib/sellerProfileStaffAccess'
import { OWNER_SHIPPING_SETUP_REQUIRED_MESSAGE } from '@/lib/sellerShippingReadiness'
import { z } from 'zod'

const ReviewActionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  reason: z.string().max(500).nullish(),
})
const ADMIN_LISTING_REVIEW_BODY_MAX_BYTES = 16 * 1024

function sellerUnavailableReason(seller: {
  chargesEnabled: boolean
  vacationMode: boolean
  ownerAccountActive: boolean
}) {
  if (!seller.ownerAccountActive) return 'Seller account is unavailable.'
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
  const admin = await userClerkGate(prisma, userId)
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

  const transition = await sellerProfileStaffListingReviewTransition(
    getOrderStaffReadClient(),
    {
      actorId: admin.id,
      listingId: id,
      operation: action === 'approve' ? 'APPROVE' : 'REJECT',
      reason: sanitizedReason,
    },
  )
  if (!transition) return privateJson({ error: 'Not found' }, { status: HTTP_STATUS.NOT_FOUND })
  const listing = transition.listing
  if (transition.blockReason === 'REASON_REQUIRED') {
    return privateJson({ error: 'Reason required for rejection' }, { status: HTTP_STATUS.BAD_REQUEST })
  }
  if (action === 'approve' && transition.blockReason) {
    if (transition.blockReason === 'SELLER_SHIPPING_UNAVAILABLE') {
      return privateJson({ error: OWNER_SHIPPING_SETUP_REQUIRED_MESSAGE }, { status: HTTP_STATUS.CONFLICT })
    }
    const unavailableReason = sellerUnavailableReason(listing.seller)
    if (!unavailableReason) {
      throw new Error('Listing review transition returned an inconsistent seller block')
    }
    return privateJson({ error: unavailableReason }, { status: HTTP_STATUS.CONFLICT })
  }
  if (!transition.applied) {
    if (
      action === 'approve' &&
      listing.status === 'ACTIVE' &&
      !sellerUnavailableReason(listing.seller) &&
      listing.customOrderConversationId &&
      listing.reservedForUserId
    ) {
      await sendCustomOrderReadyLink({
        listingId: listing.id,
        sellerUserId: listing.seller.userId,
      })
    }
    return privateJson({ ok: true, skipped: true, reason: 'Listing is no longer pending review.' })
  }
  if (!transition.auditId) {
    throw new Error('Listing review transition did not return its audit authority')
  }

  if (action === 'approve') {
    revalidateListingSearchCaches()
    revalidateFeaturedMakerCaches()
    await syncGuildThresholdAfterAdminReview(id, listing.sellerId, 'admin_listing_approve_guild_threshold')
    if (listing.status === 'ACTIVE') {
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
          sellerUserId: listing.seller.userId,
        })
      }
    }
    const notificationBody = listing.status === 'SOLD_OUT'
      ? `Your listing "${listing.title}" has been approved. Add stock to make it available to buyers.`
      : `Your listing "${listing.title}" has been approved and is now live!`
    await createNotification({
      userId: listing.seller.userId,
      type: 'LISTING_APPROVED',
      title: 'Listing approved',
      body: notificationBody,
      link: publicListingPath(id, listing.title),
      sourceType: NOTIFICATION_SOURCE_TYPES.LISTING_ADMIN_REVIEW,
      sourceId: transition.auditId,
    }).catch((error) => {
      Sentry.captureException(error, {
        level: 'warning',
        tags: { source: 'admin_listing_review_notification' },
        extra: { listingId: id, sellerUserId: listing.seller.userId, action },
      })
    })
  } else if (action === 'reject') {
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
      sourceId: transition.auditId,
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
