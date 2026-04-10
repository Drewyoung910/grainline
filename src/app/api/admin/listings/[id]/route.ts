import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logAdminAction } from "@/lib/audit";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true },
  });
  if (!admin || (admin.role !== "ADMIN" && admin.role !== "EMPLOYEE")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const listing = await prisma.listing.findUnique({
    where: { id },
    select: { id: true, title: true, sellerId: true, status: true },
  });
  if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Soft-delete: HIDDEN is already filtered from all public queries
  await prisma.listing.update({
    where: { id },
    data: { status: "HIDDEN" },
  });

  await logAdminAction({
    adminId: admin.id,
    action: "REMOVE_LISTING",
    targetType: "Listing",
    targetId: id,
    metadata: { title: listing.title, sellerId: listing.sellerId, previousStatus: listing.status },
  });

  return NextResponse.json({ ok: true });
}
