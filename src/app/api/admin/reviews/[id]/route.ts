import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { logAdminActionOrThrow } from "@/lib/audit";
import { refreshSellerRatingSummary } from "@/lib/sellerRatingSummary";
import { adminActionRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true },
  });
  if (!admin || admin.banned || admin.deletedAt || admin.role !== "ADMIN") {
    return privateJson({ error: "Forbidden" }, { status: HTTP_STATUS.FORBIDDEN });
  }
  const { success, reset } = await safeRateLimit(adminActionRatelimit, admin.id);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many admin actions."));

  const { id } = await params;
  const review = await prisma.review.findUnique({
    where: { id },
    select: {
      id: true,
      listingId: true,
      reviewerId: true,
      listing: { select: { sellerId: true } },
    },
  });
  if (!review) return privateJson({ error: "Not found" }, { status: HTTP_STATUS.NOT_FOUND });

  await prisma.$transaction(async (tx) => {
    await tx.review.delete({ where: { id } });
    await refreshSellerRatingSummary(review.listing.sellerId, tx);
    await logAdminActionOrThrow({
      client: tx,
      adminId: admin.id,
      action: "DELETE_REVIEW",
      targetType: "Review",
      targetId: id,
      metadata: { listingId: review.listingId, reviewerId: review.reviewerId },
    });
  });
  return privateJson({ ok: true });
}
