import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logAdminAction } from '@/lib/audit'
import { createNotification } from '@/lib/notifications'
import { adminActionRatelimit, rateLimitResponse, safeRateLimit } from '@/lib/ratelimit'
import { publicListingPath } from '@/lib/publicPaths'
import { z } from 'zod'

const ReviewActionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  reason: z.string().max(500).nullish(),
})

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
    select: { id: true, role: true }
  })
  if (!admin || (admin.role !== 'ADMIN' && admin.role !== 'EMPLOYEE')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  let body
  try {
    body = ReviewActionSchema.parse(await request.json())
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: e.issues }, { status: 400 })
    }
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { action, reason } = body

  const listing = await prisma.listing.findUnique({
    where: { id },
    include: { seller: { select: { userId: true, displayName: true } } }
  })
  if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (action === 'approve') {
    await prisma.listing.update({
      where: { id },
      data: { status: 'ACTIVE', reviewedByAdmin: true, reviewedAt: new Date(), rejectionReason: null }
    })
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
    }).catch(() => {})
  } else if (action === 'reject') {
    if (!reason?.trim()) return NextResponse.json({ error: 'Reason required for rejection' }, { status: 400 })
    await prisma.listing.update({
      where: { id },
      data: { status: 'REJECTED', reviewedByAdmin: true, reviewedAt: new Date(), rejectionReason: reason }
    })
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
    }).catch(() => {})
  } else {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
