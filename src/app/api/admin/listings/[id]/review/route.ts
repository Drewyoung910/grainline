import { auth } from '@clerk/nextjs/server'
import * as Sentry from '@sentry/nextjs'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logAdminAction } from '@/lib/audit'
import { createNotification } from '@/lib/notifications'
import { sendCustomOrderReadyLink } from '@/lib/customOrderReadyLink'
import { maybeGrantFoundingMaker } from '@/lib/foundingMaker'
import { adminActionRatelimit, rateLimitResponse, safeRateLimit } from '@/lib/ratelimit'
import { publicListingPath } from '@/lib/publicPaths'
import { revalidateListingSearchCaches } from '@/lib/searchCache'
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from '@/lib/requestBody'
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { success, reset } = await safeRateLimit(adminActionRatelimit, userId)
  if (!success) return rateLimitResponse(reset, 'Too many admin actions.')
  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true }
  })
  if (!admin || admin.banned || admin.deletedAt || (admin.role !== 'ADMIN' && admin.role !== 'EMPLOYEE')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  let body
  try {
    body = ReviewActionSchema.parse(await readBoundedJson(request, ADMIN_LISTING_REVIEW_BODY_MAX_BYTES))
  } catch (e) {
    if (isRequestBodyTooLargeError(e)) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 })
    }
    if (isInvalidJsonBodyError(e)) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: e.issues }, { status: 400 })
    }
    throw e
  }
  const { action, reason } = body

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
  if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (action === 'approve') {
    const unavailableReason = sellerUnavailableReason(listing.seller)
    if (unavailableReason) {
      return NextResponse.json({ error: unavailableReason }, { status: 409 })
    }

    const approved = await prisma.listing.updateMany({
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
      if (!currentListing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const currentUnavailableReason = sellerUnavailableReason(currentListing.seller)
      if (currentListing.status === 'PENDING_REVIEW' && currentUnavailableReason) {
        return NextResponse.json({ error: currentUnavailableReason }, { status: 409 })
      }
      if (
        currentListing.status === 'ACTIVE' &&
        !currentUnavailableReason &&
        currentListing.customOrderConversationId &&
        currentListing.reservedForUserId
      ) {
        await sendCustomOrderReadyLink({
          conversationId: currentListing.customOrderConversationId,
          sellerUserId: currentListing.seller.userId,
          buyerUserId: currentListing.reservedForUserId,
          sellerName: currentListing.seller.displayName,
          listing: currentListing,
        })
      }
      return NextResponse.json({ ok: true, skipped: true, reason: 'Listing is no longer pending review.' })
    }
    revalidateListingSearchCaches()
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
    await logAdminAction({
      adminId: admin.id,
      action: 'APPROVE_LISTING',
      targetType: 'LISTING',
      targetId: id,
      reason: reason || 'Approved',
    })
    await createNotification({
      userId: listing.seller.userId,
      type: 'LISTING_APPROVED',
      title: 'Listing approved',
      body: `Your listing "${listing.title}" has been approved and is now live!`,
      link: publicListingPath(id, listing.title),
    }).catch((error) => {
      Sentry.captureException(error, {
        level: 'warning',
        tags: { source: 'admin_listing_review_notification' },
        extra: { listingId: id, sellerUserId: listing.seller.userId, action },
      })
    })
    if (listing.customOrderConversationId && listing.reservedForUserId) {
      await sendCustomOrderReadyLink({
        conversationId: listing.customOrderConversationId,
        sellerUserId: listing.seller.userId,
        buyerUserId: listing.reservedForUserId,
        sellerName: listing.seller.displayName,
        listing,
      })
    }
  } else if (action === 'reject') {
    if (!reason?.trim()) return NextResponse.json({ error: 'Reason required for rejection' }, { status: 400 })
    const rejected = await prisma.listing.updateMany({
      where: { id, status: 'PENDING_REVIEW' },
      data: { status: 'REJECTED', reviewedByAdmin: true, reviewedAt: new Date(), rejectionReason: reason }
    })
    if (rejected.count === 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'Listing is no longer pending review.' })
    }
    revalidateListingSearchCaches()
    await logAdminAction({
      adminId: admin.id,
      action: 'REJECT_LISTING',
      targetType: 'LISTING',
      targetId: id,
      reason,
    })
    await createNotification({
      userId: listing.seller.userId,
      type: 'LISTING_REJECTED',
      title: 'Listing needs changes',
      body: `Your listing "${listing.title}" was not approved. Reason: ${reason}. Please edit and resubmit.`,
      link: `/dashboard/listings/${id}/edit`,
    }).catch((error) => {
      Sentry.captureException(error, {
        level: 'warning',
        tags: { source: 'admin_listing_review_notification' },
        extra: { listingId: id, sellerUserId: listing.seller.userId, action },
      })
    })
  } else {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
