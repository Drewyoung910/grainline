import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { BanUserPolicyError, banUser, unbanUser } from '@/lib/ban'
import { z } from 'zod'

const BanSchema = z.object({
  reason: z.string().min(1).max(500),
})

async function getAdmin(clerkId: string) {
  return prisma.user.findUnique({
    where: { clerkId },
    select: { id: true, role: true }
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = await getAdmin(userId)
  if (!admin || admin.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  let body
  try {
    body = BanSchema.parse(await request.json())
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: e.issues }, { status: 400 })
    }
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { reason } = body
  if (id === admin.id) return NextResponse.json({ error: 'Cannot ban yourself' }, { status: 400 })
  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } })
  if (target?.role === 'ADMIN') return NextResponse.json({ error: 'Cannot ban admin accounts' }, { status: 400 })
  try {
    await banUser({ userId: id, adminId: admin.id, reason })
  } catch (error) {
    if (error instanceof BanUserPolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = await getAdmin(userId)
  if (!admin || admin.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  let unbanBody
  try {
    unbanBody = BanSchema.parse(await request.json())
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: e.issues }, { status: 400 })
    }
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { reason } = unbanBody
  try {
    const result = await unbanUser({ userId: id, adminId: admin.id, reason })
    return NextResponse.json({ ok: true, warning: result.sellerRestoreWarning ?? undefined })
  } catch (error) {
    if (error instanceof BanUserPolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }
}
