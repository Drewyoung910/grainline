import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logAdminAction } from "@/lib/audit";

export async function POST(
  _req: Request,
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
  await prisma.userReport.update({
    where: { id },
    data: { resolved: true },
  });

  await logAdminAction({
    adminId: admin.id,
    action: "RESOLVE_REPORT",
    targetType: "UserReport",
    targetId: id,
    metadata: {},
  });

  return NextResponse.json({ ok: true });
}
