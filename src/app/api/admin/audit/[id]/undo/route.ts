import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { undoAdminAction } from '@/lib/audit'
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
    return NextResponse.json({ error: String(error) }, { status: 400 })
  }
}
