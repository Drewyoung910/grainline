import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logAdminAction } from "@/lib/audit";
import { adminActionRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true },
  });
  if (!admin || admin.banned || admin.deletedAt || (admin.role !== "ADMIN" && admin.role !== "EMPLOYEE")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { success, reset } = await safeRateLimit(adminActionRatelimit, admin.id);
  if (!success) return rateLimitResponse(reset, "Too many admin actions. Try again shortly.");

  const { id } = await params;
  const updated = await prisma.userReport.updateMany({
    where: { id, resolved: false },
    data: { resolved: true, resolvedAt: new Date(), resolvedById: admin.id },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "Report is already resolved or no longer exists." }, { status: 404 });
  }

  await logAdminAction({
    adminId: admin.id,
    action: "RESOLVE_REPORT",
    targetType: "UserReport",
    targetId: id,
    metadata: {},
  });

  return NextResponse.json({ ok: true });
}
