// src/app/admin/verification/page.tsx
import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { createNotification } from "@/lib/notifications";
import {
  sendGuildMasterRevokedEmail,
  sendGuildMemberRevokedEmail,
  sendVerificationApproved,
  sendVerificationRejected,
} from "@/lib/email";
import { meetsGuildMasterRequirements, GUILD_MASTER_REQUIREMENTS, type SellerMetricsResult } from "@/lib/metrics";
import { SELLER_METRICS_MAX_AGE_MS, isSellerMetricsFresh } from "@/lib/metricsFreshness";
import { FeatureMakerButton } from "@/components/admin/FeatureMakerButton";
import { logAdminAction } from "@/lib/audit";
import ActionForm, { SubmitButton } from "@/components/ActionForm";
import { publicSellerPath } from "@/lib/publicPaths";
import { sanitizeText } from "@/lib/sanitize";

type ActionState = { ok: boolean; error?: string };

type CachedSellerMetrics = {
  calculatedAt: Date;
  periodMonths: number;
  averageRating: number;
  reviewCount: number;
  onTimeShippingRate: number;
  responseRate: number;
  totalSalesCents: number;
  completedOrderCount: number;
  activeCaseCount: number;
  accountAgeDays: number;
};

function cachedMetricsToResult(sellerProfileId: string, metrics: CachedSellerMetrics): SellerMetricsResult {
  return {
    sellerProfileId,
    calculatedAt: metrics.calculatedAt,
    periodMonths: metrics.periodMonths,
    averageRating: metrics.averageRating,
    reviewCount: metrics.reviewCount,
    onTimeShippingRate: metrics.onTimeShippingRate,
    responseRate: metrics.responseRate,
    totalSalesCents: metrics.totalSalesCents,
    completedOrderCount: metrics.completedOrderCount,
    activeCaseCount: metrics.activeCaseCount,
    accountAgeDays: metrics.accountAgeDays,
  };
}

function formatUsd(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function guildMasterFailureDetails(
  metrics: SellerMetricsResult,
  criteria: ReturnType<typeof meetsGuildMasterRequirements>,
) {
  return [
    !criteria.ratingMet
      ? `${metrics.averageRating.toFixed(1)}/${GUILD_MASTER_REQUIREMENTS.averageRating} average rating`
      : null,
    !criteria.reviewsMet
      ? `${metrics.reviewCount}/${GUILD_MASTER_REQUIREMENTS.reviewCount} reviews`
      : null,
    !criteria.shippingMet
      ? `${(metrics.onTimeShippingRate * 100).toFixed(0)}%/${GUILD_MASTER_REQUIREMENTS.onTimeShippingRate * 100}% on-time shipping`
      : null,
    !criteria.responseMet
      ? `${(metrics.responseRate * 100).toFixed(0)}%/${GUILD_MASTER_REQUIREMENTS.responseRate * 100}% response rate`
      : null,
    !criteria.ageMet
      ? `${metrics.accountAgeDays}/${GUILD_MASTER_REQUIREMENTS.accountAgeDays} account age days`
      : null,
    !criteria.salesMet
      ? `${formatUsd(metrics.totalSalesCents)}/${formatUsd(GUILD_MASTER_REQUIREMENTS.totalSalesCents)} completed sales`
      : null,
    !criteria.casesMet
      ? `${metrics.activeCaseCount} active case${metrics.activeCaseCount === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);
}

// ── Shared auth helper ──────────────────────────────────────────────────────
async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) redirect("/");
  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true },
  });
  if (!me) redirect("/");
  if (me.banned || me.deletedAt) redirect("/banned");
  if (me.role !== "EMPLOYEE" && me.role !== "ADMIN") redirect("/");
  return me;
}

// ── Guild Member actions ────────────────────────────────────────────────────
async function approveGuildMember(_prevState: unknown, formData: FormData): Promise<ActionState> {
  "use server";
  const me = await requireAdmin();
  const verificationId = String(formData.get("verificationId") ?? "");
  const adminOverride = formData.get("adminOverride") === "on";

  const verification = await prisma.makerVerification.findUnique({
    where: { id: verificationId },
    select: {
      status: true,
      sellerProfileId: true,
      sellerProfile: {
        select: { userId: true, id: true, displayName: true, user: { select: { email: true, createdAt: true } } },
      },
    },
  });
  if (!verification) return { ok: false, error: "Application was not found. Refresh and try again." };
  if (verification.status !== "PENDING") return { ok: false, error: "Application is no longer pending. Refresh this page." };

  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const [activeListings, salesRows, longCaseCount] = await Promise.all([
    prisma.listing.count({
      where: { sellerId: verification.sellerProfileId, status: "ACTIVE", isPrivate: false },
    }),
    prisma.$queryRaw<Array<{ total: bigint | null }>>`
      SELECT COALESCE(SUM(oi."priceCents" * oi.quantity), 0) AS total
      FROM "OrderItem" oi
      INNER JOIN "Order" o ON o.id = oi."orderId"
      INNER JOIN "Listing" l ON l.id = oi."listingId"
      WHERE l."sellerId" = ${verification.sellerProfileId}
        AND o."fulfillmentStatus" IN ('DELIVERED'::"FulfillmentStatus", 'PICKED_UP'::"FulfillmentStatus")
        AND o."sellerRefundId" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "OrderPaymentEvent" ope
          WHERE ope."orderId" = o.id
            AND ope."eventType" = 'REFUND'
        )
    `,
    prisma.case.count({
      where: {
        sellerId: verification.sellerProfile.userId,
        status: { notIn: ["RESOLVED", "CLOSED"] },
        createdAt: { lt: sixtyDaysAgo },
      },
    }),
  ]);
  const totalSalesCents = Number(salesRows[0]?.total ?? 0);
  const accountAgeDays = Math.floor(
    (Date.now() - new Date(verification.sellerProfile.user.createdAt).getTime()) / (1000 * 60 * 60 * 24),
  );
  const unmetRequirements = [
    activeListings < 5 ? `${activeListings}/5 active public listings` : null,
    accountAgeDays < 30 ? `${accountAgeDays}/30 account age days` : null,
    longCaseCount > 0 ? `${longCaseCount} unresolved case${longCaseCount === 1 ? "" : "s"} older than 60 days` : null,
    !adminOverride && totalSalesCents < 25_000
      ? `${(totalSalesCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}/$250 completed non-refunded sales`
      : null,
  ].filter(Boolean);

  if (unmetRequirements.length > 0) {
    await logAdminAction({
      adminId: me.id,
      action: "APPROVE_GUILD_MEMBER_BLOCKED",
      targetType: "SELLER_PROFILE",
      targetId: verification.sellerProfileId,
      reason: "Server-side eligibility check failed",
      metadata: { activeListings, totalSalesCents, accountAgeDays, longCaseCount, adminOverride },
    });
    return {
      ok: false,
      error: `Approval blocked: ${unmetRequirements.join("; ")}.`,
    };
  }

  const approvedAt = new Date();
  const approved = await prisma.$transaction(async (tx) => {
    const updated = await tx.makerVerification.updateMany({
      where: { id: verificationId, status: "PENDING" },
      data: {
        status: "APPROVED",
        reviewedById: me.id,
        reviewedAt: approvedAt,
        reviewNotes: adminOverride ? "Admin override: $250 sales requirement waived" : null,
      },
    });
    if (updated.count === 0) return false;

    await tx.sellerProfile.update({
      where: { id: verification.sellerProfileId },
      data: {
        isVerifiedMaker: true,
        verifiedAt: approvedAt,
        guildLevel: "GUILD_MEMBER",
        guildMemberApprovedAt: approvedAt,
      },
    });
    return true;
  });
  if (!approved) return { ok: false, error: "Application changed while approving. Refresh and try again." };

  await createNotification({
    userId: verification.sellerProfile.userId,
    type: "VERIFICATION_APPROVED",
    title: "You are now a Guild Member!",
    body: "Your Guild Member badge is now live on your profile",
    link: publicSellerPath(verification.sellerProfile.id, verification.sellerProfile.displayName),
  });

  if (verification.sellerProfile.user?.email) {
    try {
      await sendVerificationApproved({
        seller: {
          displayName: verification.sellerProfile.displayName,
          email: verification.sellerProfile.user.email,
        },
        profileId: verification.sellerProfile.id,
      });
    } catch { /* non-fatal */ }
  }

  await logAdminAction({ adminId: me.id, action: "APPROVE_GUILD_MEMBER", targetType: "SELLER_PROFILE", targetId: verificationId });

  revalidatePath("/admin/verification");
  return { ok: true };
}

async function rejectGuildMember(formData: FormData) {
  "use server";
  const me = await requireAdmin();
  const verificationId = String(formData.get("verificationId") ?? "");
  const reviewNotes = sanitizeText(String(formData.get("reviewNotes") ?? "")).slice(0, 2000) || null;

  const verification = await prisma.makerVerification.findUnique({
    where: { id: verificationId },
    select: {
      status: true,
      sellerProfile: {
        select: { userId: true, displayName: true, user: { select: { email: true } } },
      },
    },
  });
  if (!verification || verification.status !== "PENDING") return;

  const rejected = await prisma.makerVerification.updateMany({
    where: { id: verificationId, status: "PENDING" },
    data: {
      status: "REJECTED",
      reviewedById: me.id,
      reviewedAt: new Date(),
      reviewNotes,
    },
  });
  if (rejected.count === 0) return;

  if (verification?.sellerProfile.userId) {
    await createNotification({
      userId: verification.sellerProfile.userId,
      type: "VERIFICATION_REJECTED",
      title: "Guild Member application update",
      body: reviewNotes ?? "Please review your application",
      link: "/dashboard/verification",
    });
  }

  if (verification?.sellerProfile.user?.email) {
    try {
      await sendVerificationRejected({
        seller: {
          displayName: verification.sellerProfile.displayName,
          email: verification.sellerProfile.user.email,
        },
        notes: reviewNotes,
      });
    } catch { /* non-fatal */ }
  }

  await logAdminAction({ adminId: me.id, action: "REJECT_GUILD_MEMBER", targetType: "SELLER_PROFILE", targetId: verificationId, reason: reviewNotes ?? undefined });

  revalidatePath("/admin/verification");
}

async function revokeMember(sellerProfileId: string) {
  "use server";
  const me = await requireAdmin();
  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerProfileId },
    select: { userId: true, displayName: true, user: { select: { email: true } } },
  });

  const revokedAt = new Date();
  const revoked = await prisma.$transaction(async (tx) => {
    const updated = await tx.sellerProfile.updateMany({
      where: { id: sellerProfileId, guildLevel: "GUILD_MEMBER" },
      data: {
        guildLevel: "NONE",
        isVerifiedMaker: false,
        consecutiveMetricFailures: 0,
        metricWarningSentAt: null,
        listingsBelowThresholdSince: null,
        lastMetricCheckAt: revokedAt,
      },
    });
    if (updated.count === 0) return false;

    await tx.makerVerification.updateMany({
      where: { sellerProfileId },
      data: {
        status: "REJECTED",
        reviewedById: me.id,
        reviewedAt: revokedAt,
        reviewNotes: "Guild Member badge revoked by Grainline staff.",
      },
    });
    return true;
  });
  if (!revoked) return;

  if (seller?.userId) {
    await createNotification({
      userId: seller.userId,
      type: "VERIFICATION_REJECTED",
      title: "Guild Member badge revoked",
      body: "Your Guild Member badge was revoked by Grainline staff.",
      link: "/dashboard/verification",
    });
  }
  if (seller?.user?.email) {
    try {
      await sendGuildMemberRevokedEmail({
        seller: { displayName: seller.displayName, email: seller.user.email },
        reason: "Your Guild Member badge was revoked by Grainline staff.",
      });
    } catch { /* non-fatal */ }
  }

  await logAdminAction({ adminId: me.id, action: "REVOKE_GUILD_MEMBER", targetType: "SELLER_PROFILE", targetId: sellerProfileId });

  revalidatePath("/admin/verification");
}

// ── Guild Master actions ─────────────────────────────────────────────────────
async function approveGuildMaster(_prevState: unknown, formData: FormData): Promise<ActionState> {
  "use server";
  const me = await requireAdmin();
  const verificationId = String(formData.get("verificationId") ?? "");

  const verification = await prisma.makerVerification.findUnique({
    where: { id: verificationId },
    select: {
      status: true,
      sellerProfileId: true,
      sellerProfile: {
        select: {
          userId: true,
          id: true,
          displayName: true,
          user: { select: { email: true } },
          sellerMetrics: {
            select: {
              calculatedAt: true,
              periodMonths: true,
              averageRating: true,
              reviewCount: true,
              onTimeShippingRate: true,
              responseRate: true,
              totalSalesCents: true,
              completedOrderCount: true,
              activeCaseCount: true,
              accountAgeDays: true,
            },
          },
        },
      },
    },
  });
  if (!verification) return { ok: false, error: "Application was not found. Refresh and try again." };
  if (verification.status !== "GUILD_MASTER_PENDING") {
    return { ok: false, error: "Application is no longer pending. Refresh this page." };
  }

  if (
    !verification.sellerProfile.sellerMetrics ||
    !isSellerMetricsFresh(verification.sellerProfile.sellerMetrics)
  ) {
    return {
      ok: false,
      error: "Cached Guild metrics are missing or stale. Ask the seller to refresh the verification page, or run the metrics cron, before approval.",
    };
  }

  const metrics = cachedMetricsToResult(verification.sellerProfileId, verification.sellerProfile.sellerMetrics);
  const criteria = meetsGuildMasterRequirements(metrics);
  if (!criteria.allMet) {
    await logAdminAction({
      adminId: me.id,
      action: "APPROVE_GUILD_MASTER_BLOCKED",
      targetType: "SELLER_PROFILE",
      targetId: verification.sellerProfileId,
      reason: "Server-side Guild Master metrics check failed",
      metadata: { metrics, criteria },
    });
    return {
      ok: false,
      error: `Approval blocked: ${guildMasterFailureDetails(metrics, criteria).join("; ")}.`,
    };
  }

  const approvedAt = new Date();
  const approved = await prisma.$transaction(async (tx) => {
    const updated = await tx.makerVerification.updateMany({
      where: { id: verificationId, status: "GUILD_MASTER_PENDING" },
      data: { status: "GUILD_MASTER_APPROVED", reviewedById: me.id, reviewedAt: approvedAt },
    });
    if (updated.count === 0) return false;

    await tx.sellerProfile.update({
      where: { id: verification.sellerProfileId },
      data: { guildLevel: "GUILD_MASTER", guildMasterApprovedAt: approvedAt },
    });
    return true;
  });
  if (!approved) return { ok: false, error: "Application changed while approving. Refresh and try again." };

  await createNotification({
    userId: verification.sellerProfile.userId,
    type: "VERIFICATION_APPROVED",
    title: "You are now a Guild Master!",
    body: "Your Guild Master badge is now live on your profile",
    link: publicSellerPath(verification.sellerProfile.id, verification.sellerProfile.displayName),
  });

  if (verification.sellerProfile.user?.email) {
    try {
      await sendVerificationApproved({
        seller: {
          displayName: verification.sellerProfile.displayName,
          email: verification.sellerProfile.user.email,
        },
        profileId: verification.sellerProfile.id,
      });
    } catch { /* non-fatal */ }
  }

  await logAdminAction({ adminId: me.id, action: "APPROVE_GUILD_MASTER", targetType: "SELLER_PROFILE", targetId: verification.sellerProfileId });

  revalidatePath("/admin/verification");
  return { ok: true };
}

async function rejectGuildMaster(formData: FormData) {
  "use server";
  const me = await requireAdmin();
  const verificationId = String(formData.get("verificationId") ?? "");
  const reviewNotes = sanitizeText(String(formData.get("reviewNotes") ?? "")).slice(0, 2000) || null;

  const verification = await prisma.makerVerification.findUnique({
    where: { id: verificationId },
    select: {
      status: true,
      sellerProfileId: true,
      sellerProfile: {
        select: { userId: true, displayName: true, user: { select: { email: true } } },
      },
    },
  });
  if (!verification || verification.status !== "GUILD_MASTER_PENDING") return;

  const rejected = await prisma.$transaction(async (tx) => {
    const updated = await tx.makerVerification.updateMany({
      where: { id: verificationId, status: "GUILD_MASTER_PENDING" },
      data: { status: "GUILD_MASTER_REJECTED", reviewedById: me.id, reviewedAt: new Date() },
    });
    if (updated.count === 0) return false;

    await tx.sellerProfile.update({
      where: { id: verification.sellerProfileId },
      data: { guildMasterReviewNotes: reviewNotes },
    });
    return true;
  });
  if (!rejected) return;

  if (verification?.sellerProfile.userId) {
    await createNotification({
      userId: verification.sellerProfile.userId,
      type: "VERIFICATION_REJECTED",
      title: "Guild Master application update",
      body: reviewNotes ?? "Please review your application",
      link: "/dashboard/verification",
    });
  }

  await logAdminAction({ adminId: me.id, action: "REJECT_GUILD_MASTER", targetType: "SELLER_PROFILE", targetId: verification?.sellerProfileId ?? verificationId, reason: reviewNotes ?? undefined });

  revalidatePath("/admin/verification");
}

async function revokeMaster(sellerProfileId: string) {
  "use server";
  const me = await requireAdmin();
  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerProfileId },
    select: { userId: true, displayName: true, user: { select: { email: true } } },
  });

  const revokedAt = new Date();
  const revoked = await prisma.$transaction(async (tx) => {
    const updated = await tx.sellerProfile.updateMany({
      where: { id: sellerProfileId, guildLevel: "GUILD_MASTER" },
      data: {
        guildLevel: "GUILD_MEMBER",
        consecutiveMetricFailures: 0,
        metricWarningSentAt: null,
        lastMetricCheckAt: revokedAt,
        guildMasterApprovedAt: null,
        guildMasterAppliedAt: null,
        guildMasterReviewNotes: null,
      },
    });
    if (updated.count === 0) return false;

    await tx.makerVerification.updateMany({
      where: { sellerProfileId },
      data: {
        status: "APPROVED",
        reviewedById: me.id,
        reviewedAt: revokedAt,
        reviewNotes: null,
      },
    });
    return true;
  });
  if (!revoked) return;

  if (seller?.userId) {
    await createNotification({
      userId: seller.userId,
      type: "VERIFICATION_REJECTED",
      title: "Guild Master badge revoked",
      body: "Your Guild Master badge was revoked. Your Guild Member badge remains active.",
      link: "/dashboard/verification",
    });
  }
  if (seller?.user?.email) {
    try {
      await sendGuildMasterRevokedEmail({
        seller: { displayName: seller.displayName, email: seller.user.email },
      });
    } catch { /* non-fatal */ }
  }

  await logAdminAction({ adminId: me.id, action: "REVOKE_GUILD_MASTER", targetType: "SELLER_PROFILE", targetId: sellerProfileId });

  revalidatePath("/admin/verification");
}

async function reinstateGuildMember(formData: FormData) {
  "use server";
  const me = await requireAdmin();
  const sellerProfileId = String(formData.get("sellerProfileId") ?? "");
  if (!sellerProfileId) return;

  const reinstatedAt = new Date();
  const reinstated = await prisma.$transaction(async (tx) => {
    const updated = await tx.sellerProfile.updateMany({
      where: { id: sellerProfileId, guildLevel: "NONE", guildMemberApprovedAt: { not: null } },
      data: {
        guildLevel: "GUILD_MEMBER",
        isVerifiedMaker: true,
        consecutiveMetricFailures: 0,
        metricWarningSentAt: null,
        listingsBelowThresholdSince: null,
        lastMetricCheckAt: reinstatedAt,
      },
    });
    if (updated.count === 0) return false;

    await tx.makerVerification.updateMany({
      where: { sellerProfileId },
      data: {
        status: "APPROVED",
        reviewedById: me.id,
        reviewedAt: reinstatedAt,
        reviewNotes: null,
      },
    });
    return true;
  });
  if (!reinstated) return;

  await logAdminAction({
    adminId: me.id,
    action: "REINSTATE_GUILD_MEMBER",
    targetType: "SELLER_PROFILE",
    targetId: sellerProfileId,
  });

  revalidatePath("/admin/verification");
}

async function featureMaker(sellerProfileId: string) {
  "use server";
  const me = await requireAdmin();

  const ownSeller = await prisma.sellerProfile.findUnique({
    where: { userId: me.id },
    select: { id: true },
  });
  if (ownSeller?.id === sellerProfileId) return;

  const now = new Date();
  const result = await prisma.sellerProfile.updateMany({
    where: {
      id: sellerProfileId,
      OR: [{ featuredUntil: null }, { featuredUntil: { lte: now } }],
    },
    data: { featuredUntil: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) },
  });
  if (result.count === 0) return;

  await logAdminAction({
    adminId: me.id,
    action: "FEATURE_MAKER",
    targetType: "SELLER_PROFILE",
    targetId: sellerProfileId,
  });

  revalidatePath("/admin/verification");
  revalidatePath("/");
  revalidateTag("home-featured-maker", "max");
}

async function unfeatureMaker(sellerProfileId: string) {
  "use server";
  const me = await requireAdmin();

  const result = await prisma.sellerProfile.updateMany({
    where: { id: sellerProfileId, featuredUntil: { not: null } },
    data: { featuredUntil: null },
  });
  if (result.count === 0) return;

  await logAdminAction({
    adminId: me.id,
    action: "UNFEATURE_MAKER",
    targetType: "SELLER_PROFILE",
    targetId: sellerProfileId,
  });

  revalidatePath("/admin/verification");
  revalidatePath("/");
  revalidateTag("home-featured-maker", "max");
}

// ── Page ────────────────────────────────────────────────────────────────────
export default async function AdminVerificationPage() {
  const [memberPending, masterPending, memberActive, masterActive, revokedMembers] = await Promise.all([
    prisma.makerVerification.findMany({
      where: { status: "PENDING" },
      orderBy: { appliedAt: "asc" },
      take: 50,
      include: {
        sellerProfile: { select: { displayName: true, id: true } },
      },
    }),
    prisma.makerVerification.findMany({
      where: { status: "GUILD_MASTER_PENDING" },
      orderBy: { appliedAt: "asc" },
      take: 50,
      include: {
        sellerProfile: {
          select: {
            displayName: true,
            id: true,
            guildMasterAppliedAt: true,
            sellerMetrics: {
              select: {
                calculatedAt: true,
                periodMonths: true,
                averageRating: true,
                reviewCount: true,
                onTimeShippingRate: true,
                responseRate: true,
                totalSalesCents: true,
                completedOrderCount: true,
                activeCaseCount: true,
                accountAgeDays: true,
              },
            },
          },
        },
      },
    }),
    prisma.sellerProfile.findMany({
      where: { guildLevel: "GUILD_MEMBER" },
      select: { id: true, displayName: true, guildMemberApprovedAt: true, featuredUntil: true },
      orderBy: { guildMemberApprovedAt: "desc" },
      take: 50,
    }),
    prisma.sellerProfile.findMany({
      where: { guildLevel: "GUILD_MASTER" },
      select: { id: true, displayName: true, guildMasterApprovedAt: true, featuredUntil: true },
      orderBy: { guildMasterApprovedAt: "desc" },
      take: 50,
    }),
    prisma.sellerProfile.findMany({
      where: { guildLevel: "NONE", guildMemberApprovedAt: { not: null } },
      select: { id: true, displayName: true, guildMemberApprovedAt: true },
      orderBy: { guildMemberApprovedAt: "desc" },
      take: 50,
    }),
  ]);

  const masterMetricsMap = new Map<string, SellerMetricsResult>();
  for (const v of masterPending) {
    if (v.sellerProfile.sellerMetrics && isSellerMetricsFresh(v.sellerProfile.sellerMetrics)) {
      masterMetricsMap.set(v.id, cachedMetricsToResult(v.sellerProfile.id, v.sellerProfile.sellerMetrics));
    }
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold">Guild Verification</h1>
      </div>

      {/* ── Guild Member Applications ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold border-b border-neutral-100 pb-2">
          Guild Member Applications{" "}
          <span className="text-sm font-normal text-neutral-500">({memberPending.length} pending)</span>
        </h2>

        {memberPending.length === 0 ? (
          <div className="card-section p-6 text-neutral-500 text-sm">No pending Guild Member applications.</div>
        ) : (
          <div className="space-y-4">
            {memberPending.map((v) => (
              <div key={v.id} className="card-section p-6 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-semibold text-base">{v.sellerProfile.displayName}</div>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      Applied {new Date(v.appliedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                  </div>
                  <a
                    href={publicSellerPath(v.sellerProfile.id, v.sellerProfile.displayName)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs underline text-neutral-500 hover:text-neutral-700 shrink-0"
                  >
                    View profile ↗
                  </a>
                </div>

                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium text-neutral-700">About their craft:</span>
                    <p className="text-neutral-600 mt-0.5 whitespace-pre-wrap">{v.craftDescription}</p>
                  </div>
                  <div className="flex gap-6">
                    <div>
                      <span className="font-medium text-neutral-700">Experience:</span>{" "}
                      <span className="text-neutral-600">{v.yearsExperience} year{v.yearsExperience !== 1 ? "s" : ""}</span>
                    </div>
                    {v.portfolioUrl && (
                      <div>
                        <span className="font-medium text-neutral-700">Portfolio:</span>{" "}
                        <a href={v.portfolioUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline break-all hover:text-blue-800">
                          {v.portfolioUrl}
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Admin review checklist ── */}
                <div className="rounded-lg border border-neutral-100 bg-neutral-50 px-4 py-3 space-y-2">
                  <p className="text-xs font-semibold text-neutral-600 uppercase tracking-wide">Admin Review Checklist</p>
                  <ul className="text-xs text-neutral-600 space-y-1">
                    {[
                      "Profile photo uploaded",
                      "Bio written (not placeholder text)",
                      "At least 5 active listings with real photos",
                      "Shop policies filled out",
                      "No suspicious activity or red flags",
                      "Craft description sounds authentic",
                      "Portfolio URL checked (if provided)",
                      "Sales requirement met or admin override applied",
                    ].map((item) => (
                      <li key={item} className="flex items-center gap-1.5">
                        <span className="text-neutral-300">□</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-wrap items-start gap-3 pt-2 border-t border-neutral-100">
                  <ActionForm action={approveGuildMember} className="flex flex-col gap-2">
                    <input type="hidden" name="verificationId" value={v.id} />
                    <div className="flex items-center gap-2 text-xs text-neutral-600">
                      <input
                        type="checkbox"
                        name="adminOverride"
                        id={`override-${v.id}`}
                        className="accent-amber-700"
                      />
                      <label htmlFor={`override-${v.id}`} className="cursor-pointer select-none">
                        Override $250 sales requirement{" "}
                        <span className="text-neutral-400">(for trusted early sellers you know personally)</span>
                      </label>
                    </div>
                    <SubmitButton className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-60 self-start">
                      Approve Guild Member
                    </SubmitButton>
                  </ActionForm>
                  <form action={rejectGuildMember} className="flex items-start gap-2 flex-wrap">
                    <input type="hidden" name="verificationId" value={v.id} />
                    <input
                      name="reviewNotes"
                      type="text"
                      placeholder="Rejection notes (optional)"
                      className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300 w-56"
                    />
                    <button type="submit" className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
                      Reject
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Guild Master Applications ── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold border-b border-neutral-100 pb-2">
          Guild Master Applications{" "}
          <span className="text-sm font-normal text-neutral-500">({masterPending.length} pending)</span>
        </h2>

        {masterPending.length === 0 ? (
          <div className="card-section p-6 text-neutral-500 text-sm">No pending Guild Master applications.</div>
        ) : (
          <div className="space-y-4">
            {masterPending.map((v) => {
              const m = masterMetricsMap.get(v.id);
              const mc = m ? meetsGuildMasterRequirements(m) : null;
              return (
              <div key={v.id} className="card-section p-6 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-semibold text-base">{v.sellerProfile.displayName}</div>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      Applied{" "}
                      {v.sellerProfile.guildMasterAppliedAt
                        ? new Date(v.sellerProfile.guildMasterAppliedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                        : "—"}
                    </div>
                  </div>
                  <a
                    href={publicSellerPath(v.sellerProfile.id, v.sellerProfile.displayName)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs underline text-neutral-500 hover:text-neutral-700 shrink-0"
                  >
                    View profile ↗
                  </a>
                </div>

                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium text-neutral-700">Business narrative:</span>
                    <p className="text-neutral-600 mt-0.5 whitespace-pre-wrap">
                      {v.guildMasterCraftBusiness ?? v.craftDescription}
                    </p>
                  </div>
                  {v.portfolioUrl && (
                    <div>
                      <span className="font-medium text-neutral-700">Portfolio:</span>{" "}
                      <a href={v.portfolioUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline break-all hover:text-blue-800">
                        {v.portfolioUrl}
                      </a>
                    </div>
                  )}
                </div>

                {/* ── Cached metrics dashboard ── */}
                {m && mc ? (
                  <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-indigo-800 uppercase tracking-wide">Cached Metrics</p>
                      {mc.allMet
                        ? <span className="text-xs text-green-700 font-medium">✓ All requirements met</span>
                        : <span className="text-xs text-amber-700 font-medium">⚠ Some requirements not met</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                      {[
                        { label: "Avg Rating", value: `${m.averageRating.toFixed(1)} ★`, req: `≥${GUILD_MASTER_REQUIREMENTS.averageRating}`, met: mc.ratingMet },
                        { label: "Reviews", value: String(m.reviewCount), req: `≥${GUILD_MASTER_REQUIREMENTS.reviewCount}`, met: mc.reviewsMet },
                        { label: "On-Time Shipping", value: `${(m.onTimeShippingRate * 100).toFixed(0)}%`, req: `≥${GUILD_MASTER_REQUIREMENTS.onTimeShippingRate * 100}%`, met: mc.shippingMet },
                        { label: "Response Rate", value: `${(m.responseRate * 100).toFixed(0)}%`, req: `≥${GUILD_MASTER_REQUIREMENTS.responseRate * 100}%`, met: mc.responseMet },
                        { label: "Account Age", value: `${m.accountAgeDays}d`, req: `≥${GUILD_MASTER_REQUIREMENTS.accountAgeDays}d`, met: mc.ageMet },
                        { label: "Total Sales", value: formatUsd(m.totalSalesCents), req: "≥$1,000", met: mc.salesMet },
                        { label: "Open Cases", value: String(m.activeCaseCount), req: "0", met: mc.casesMet },
                        { label: "Orders", value: String(m.completedOrderCount), req: "—", met: true },
                      ].map(({ label, value, req, met }) => (
                        <div key={label} className="flex items-center gap-1.5">
                          <span className={met ? "text-green-600" : "text-red-500"}>{met ? "✓" : "✗"}</span>
                          <span className="text-indigo-900 font-medium">{label}:</span>
                          <span className={met ? "text-green-700" : "text-red-600"}>{value}</span>
                          <span className="text-indigo-400">({req})</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-indigo-500 pt-1">
                      Metrics calculated {m.calculatedAt.toLocaleDateString("en-US")} · {m.periodMonths}-month period · valid for {Math.round(SELLER_METRICS_MAX_AGE_MS / (24 * 60 * 60 * 1000))} days
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                    Cached Guild metrics are missing or stale. Approval is blocked until the seller refreshes their verification page or the metrics cron updates this profile.
                  </div>
                )}

                <div className="flex flex-wrap items-start gap-3 pt-2 border-t border-neutral-100">
                  {m && mc ? (
                    <ActionForm action={approveGuildMaster}>
                      <input type="hidden" name="verificationId" value={v.id} />
                      <SubmitButton className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-60">
                        Approve Guild Master
                      </SubmitButton>
                    </ActionForm>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="rounded-lg bg-neutral-200 px-4 py-2 text-sm font-medium text-neutral-500 disabled:cursor-not-allowed"
                    >
                      Approval unavailable
                    </button>
                  )}
                  <form action={rejectGuildMaster} className="flex items-start gap-2 flex-wrap">
                    <input type="hidden" name="verificationId" value={v.id} />
                    <input
                      name="reviewNotes"
                      type="text"
                      placeholder="Rejection notes (optional)"
                      className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300 w-56"
                    />
                    <button type="submit" className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
                      Reject
                    </button>
                  </form>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Active Guild Members (revocable) ── */}
      {memberActive.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold border-b border-neutral-100 pb-2 text-amber-800">
            Active Guild Members ({memberActive.length})
          </h2>
          <div className="space-y-2">
            {memberActive.map((s) => (
              <div key={s.id} className="flex items-center justify-between card-section px-5 py-3">
                <div>
                  <div className="font-medium text-sm">{s.displayName}</div>
                  {s.guildMemberApprovedAt && (
                    <div className="text-xs text-neutral-500">
                      Approved {new Date(s.guildMemberApprovedAt).toLocaleDateString("en-US")}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <FeatureMakerButton
                    sellerProfileId={s.id}
                    isFeatured={s.featuredUntil != null && s.featuredUntil > new Date()}
                    featureAction={featureMaker}
                    unfeatureAction={unfeatureMaker}
                  />
                  <form action={revokeMember.bind(null, s.id)}>
                    <button type="submit" className="rounded border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50">
                      Revoke Badge
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Active Guild Masters (revocable) ── */}
      {masterActive.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold border-b border-neutral-100 pb-2 text-indigo-800">
            Active Guild Masters ({masterActive.length})
          </h2>
          <div className="space-y-2">
            {masterActive.map((s) => (
              <div key={s.id} className="flex items-center justify-between card-section px-5 py-3">
                <div>
                  <div className="font-medium text-sm">{s.displayName}</div>
                  {s.guildMasterApprovedAt && (
                    <div className="text-xs text-neutral-500">
                      Approved {new Date(s.guildMasterApprovedAt).toLocaleDateString("en-US")}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <FeatureMakerButton
                    sellerProfileId={s.id}
                    isFeatured={s.featuredUntil != null && s.featuredUntil > new Date()}
                    featureAction={featureMaker}
                    unfeatureAction={unfeatureMaker}
                  />
                  <form action={revokeMaster.bind(null, s.id)}>
                    <button type="submit" className="rounded border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50">
                      Revoke Guild Master
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {/* ── Revoked Guild Members (reinstateable) ── */}
      {revokedMembers.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold border-b border-neutral-100 pb-2 text-neutral-600">
            Revoked Guild Members ({revokedMembers.length})
          </h2>
          <div className="space-y-2">
            {revokedMembers.map((s) => (
              <div key={s.id} className="flex items-center justify-between card-section px-5 py-3">
                <div>
                  <div className="font-medium text-sm">{s.displayName}</div>
                  {s.guildMemberApprovedAt && (
                    <div className="text-xs text-neutral-500">
                      Was approved {new Date(s.guildMemberApprovedAt).toLocaleDateString("en-US")}
                    </div>
                  )}
                </div>
                <form action={reinstateGuildMember}>
                  <input type="hidden" name="sellerProfileId" value={s.id} />
                  <button type="submit" className="rounded border border-green-300 px-3 py-1 text-xs text-green-700 hover:bg-green-50">
                    Reinstate
                  </button>
                </form>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
