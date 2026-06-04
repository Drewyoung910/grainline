import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { undoAdminAction } from '@/lib/audit'
import { adminActionRatelimit, rateLimitResponse, safeRateLimit } from '@/lib/ratelimit'
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from '@/lib/requestBody'
import { logServerError } from '@/lib/serverErrorLogger'
import { z } from 'zod'

const UndoSchema = z.object({
  reason: z.string().min(1).max(500),
})
const ADMIN_AUDIT_UNDO_BODY_MAX_BYTES = 16 * 1024

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true }
  })
  if (!admin || admin.banned || admin.deletedAt || admin.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { success, reset } = await safeRateLimit(adminActionRatelimit, admin.id)
  if (!success) return rateLimitResponse(reset, 'Too many admin actions.')
  const { id } = await params
  let body
  try {
    body = UndoSchema.parse(await readBoundedJson(request, ADMIN_AUDIT_UNDO_BODY_MAX_BYTES))
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
  const { reason } = body
  try {
    await undoAdminAction({ logId: id, adminId: admin.id, reason })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Action could not be undone'
    const safeMessages = new Set([
      'Action not found',
      'Already undone',
      'Already undone (concurrent request)',
      'Undo window expired (24 hours)',
      'Admins cannot undo their own actions',
    ])
    const safeMessage = safeMessages.has(message) || message.endsWith('cannot be undone')
      ? message
      : 'This action cannot be undone.'
    if (safeMessage === 'This action cannot be undone.') {
      logServerError(error, { source: 'admin_audit_undo_route', extra: { auditLogId: id, adminId: admin.id } })
    }
    return NextResponse.json({ error: safeMessage }, { status: 400 })
  }
}
