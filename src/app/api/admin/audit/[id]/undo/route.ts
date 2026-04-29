import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { undoAdminAction } from '@/lib/audit'
import { adminActionRatelimit, rateLimitResponse, safeRateLimit } from '@/lib/ratelimit'
import { z } from 'zod'

const UndoSchema = z.object({
  reason: z.string().min(1).max(500),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true }
  })
  if (!admin || admin.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { success, reset } = await safeRateLimit(adminActionRatelimit, admin.id)
  if (!success) return rateLimitResponse(reset, 'Too many admin actions.')
  const { id } = await params
  let body
  try {
    body = UndoSchema.parse(await request.json())
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: e.issues }, { status: 400 })
    }
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { reason } = body
  try {
    await undoAdminAction({ logId: id, adminId: admin.id, reason })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Admin undo failed:', error)
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
    return NextResponse.json({ error: safeMessage }, { status: 400 })
  }
}
