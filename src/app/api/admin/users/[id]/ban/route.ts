import { auth } from '@clerk/nextjs/server'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { BanUserPolicyError, banUser, unbanUser } from '@/lib/ban'
import { adminActionRatelimit, rateLimitResponse, safeRateLimit } from '@/lib/ratelimit'
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from '@/lib/requestBody'
import { privateJson, privateResponse } from '@/lib/privateResponse'
import { HTTP_STATUS } from '@/lib/httpStatus'
import { z } from 'zod'

const BanSchema = z.object({
  reason: z.string().min(1).max(500),
})
const ADMIN_USER_BAN_BODY_MAX_BYTES = 16 * 1024

async function getAdmin(clerkId: string) {
  return prisma.user.findUnique({
    where: { clerkId },
    select: { id: true, role: true, banned: true, deletedAt: true }
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return privateJson({ error: 'Unauthorized' }, { status: HTTP_STATUS.UNAUTHORIZED })
  const admin = await getAdmin(userId)
  if (!admin || admin.banned || admin.deletedAt || admin.role !== 'ADMIN') return privateJson({ error: 'Forbidden' }, { status: HTTP_STATUS.FORBIDDEN })
  const { success, reset } = await safeRateLimit(adminActionRatelimit, admin.id)
  if (!success) return privateResponse(rateLimitResponse(reset, 'Too many admin actions.'))
  const { id } = await params
  let body
  try {
    body = BanSchema.parse(await readBoundedJson(request, ADMIN_USER_BAN_BODY_MAX_BYTES))
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
  const { reason } = body
  if (id === admin.id) return privateJson({ error: 'Cannot ban yourself' }, { status: HTTP_STATUS.BAD_REQUEST })
  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } })
  if (target?.role === 'ADMIN') return privateJson({ error: 'Cannot ban admin accounts' }, { status: HTTP_STATUS.BAD_REQUEST })
  try {
    await banUser({ userId: id, adminId: admin.id, reason })
  } catch (error) {
    if (error instanceof BanUserPolicyError) {
      return privateJson({ error: error.message }, { status: error.status })
    }
    throw error
  }
  return privateJson({ ok: true })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return privateJson({ error: 'Unauthorized' }, { status: HTTP_STATUS.UNAUTHORIZED })
  const admin = await getAdmin(userId)
  if (!admin || admin.banned || admin.deletedAt || admin.role !== 'ADMIN') return privateJson({ error: 'Forbidden' }, { status: HTTP_STATUS.FORBIDDEN })
  const { success, reset } = await safeRateLimit(adminActionRatelimit, admin.id)
  if (!success) return privateResponse(rateLimitResponse(reset, 'Too many admin actions.'))
  const { id } = await params
  let unbanBody
  try {
    unbanBody = BanSchema.parse(await readBoundedJson(request, ADMIN_USER_BAN_BODY_MAX_BYTES))
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
  const { reason } = unbanBody
  try {
    const result = await unbanUser({ userId: id, adminId: admin.id, reason })
    return privateJson({ ok: true, warning: result.sellerRestoreWarning ?? undefined })
  } catch (error) {
    if (error instanceof BanUserPolicyError) {
      return privateJson({ error: error.message }, { status: error.status })
    }
    throw error
  }
}
