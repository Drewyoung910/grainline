// src/app/dashboard/verification/page.tsx
import { redirect } from "next/navigation";
import { ensureSeller } from "@/lib/ensureSeller";
import { prisma } from "@/lib/db";
import GuildBadge from "@/components/GuildBadge";
import { calculateSellerMetrics, meetsGuildMasterRequirements, GUILD_MASTER_REQUIREMENTS } from "@/lib/metrics";
import { truncateText } from "@/lib/sanitize";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const REQUIRED_LISTINGS = 5;
const REQUIRED_SALES_CENTS = 25000; // $250
const REQUIRED_ACCOUNT_DAYS = 30;

function normalizeHttpsUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" && url.toString().length <= 500 ? url.toString() : null;
  } catch {
    return null;
  }
}

async function getGuildMemberEligibility({
  sellerProfileId,
  sellerUserId,
  accountCreatedAt,
}: {
  sellerProfileId: string;
  sellerUserId: string;
  accountCreatedAt: Date | null | undefined;
}) {
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  const [listingCount, salesRows, caseCount] = await Promise.all([
    prisma.listing.count({ where: { sellerId: sellerProfileId, status: "ACTIVE" } }),
    prisma.$queryRaw<Array<{ totalSalesCents: bigint | null }>>`
      SELECT COALESCE(SUM(oi."priceCents" * oi.quantity), 0)::bigint AS "totalSalesCents"
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      JOIN "Listing" l ON l.id = oi."listingId"
      WHERE l."sellerId" = ${sellerProfileId}
        AND o."fulfillmentStatus" IN ('DELIVERED', 'PICKED_UP')
        AND o."sellerRefundId" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "OrderPaymentEvent" ope
          WHERE ope."orderId" = o.id
            AND ope."eventType" = 'REFUND'
        )
    `,
    prisma.case.count({
      where: {
        sellerId: sellerUserId,
        status: { notIn: ["RESOLVED", "CLOSED"] },
        createdAt: { lt: sixtyDaysAgo },
      },
    }),
  ]);

  const totalSalesCents = Number(salesRows[0]?.totalSalesCents ?? 0);
  const accountAgeDays = accountCreatedAt
    ? Math.floor((Date.now() - new Date(accountCreatedAt).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  return {
    activeListings: listingCount,
    totalSalesCents,
    accountAgeDays,
    longCaseCount: caseCount,
    criteriaListingsMet: listingCount >= REQUIRED_LISTINGS,
    criteriaSalesMet: totalSalesCents >= REQUIRED_SALES_CENTS,
    criteriaAgeMet: accountAgeDays >= REQUIRED_ACCOUNT_DAYS,
    criteriaCasesMet: caseCount === 0,
  };
}

export default async function VerificationPage() {
  const { seller } = await ensureSeller();
  if (!seller) redirect("/sign-in");

  const fullSeller = await prisma.sellerProfile.findUnique({
    where: { id: seller.id },
    select: {
      id: true,
      userId: true,
      bio: true,
      avatarImageUrl: true,
      returnPolicy: true,
      customOrderPolicy: true,
      shippingPolicy: true,
      guildLevel: true,
      guildMemberApprovedAt: true,
      guildMasterApprovedAt: true,
      guildMasterAppliedAt: true,
      guildMasterReviewNotes: true,
      consecutiveMetricFailures: true,
      lastMetricCheckAt: true,
      metricWarningSentAt: true,
      makerVerification: true,
      user: { select: { createdAt: true } },
    },
  });
  if (!fullSeller) redirect("/sign-in");

  const verification = fullSeller.makerVerification;
  const guildLevel = fullSeller.guildLevel;

  // ── Section A state ────────────────────────────────────────────────────────
  const isMemberActive = guildLevel === "GUILD_MEMBER" || guildLevel === "GUILD_MASTER";
  const isMemberPending = !isMemberActive && verification?.status === "PENDING";
  const isMemberRejected = !isMemberActive && !isMemberPending && verification?.status === "REJECTED";

  // ── Section B state (only relevant if at least GUILD_MEMBER) ──────────────
  const showSectionB = isMemberActive;
  const isMasterActive = guildLevel === "GUILD_MASTER";
  const isMasterPending = !isMasterActive && verification?.status === "GUILD_MASTER_PENDING";
  const isMasterRejected =
    !isMasterActive && !isMasterPending && verification?.status === "GUILD_MASTER_REJECTED";

  // ── Guild Master metrics (only fetch when section B is visible) ───────────
  let masterMetrics = null;
  let masterCriteria = null;
  if (showSectionB && !isMasterActive) {
    try {
      masterMetrics = await calculateSellerMetrics(seller.id);
      masterCriteria = meetsGuildMasterRequirements(masterMetrics);
    } catch {
      // metrics unavailable — don't block rendering
    }
  }

  // ── Eligibility criteria (only needed when not already active/pending) ────
  let activeListings = 0;
  let totalSalesCents = 0;
  let accountAgeDays = 0;
  let longCaseCount = 0;
  let profileComplete = false;

  if (!isMemberActive && !isMemberPending) {
    const eligibility = await getGuildMemberEligibility({
      sellerProfileId: seller.id,
      sellerUserId: fullSeller.userId,
      accountCreatedAt: fullSeller.user?.createdAt,
    });
    activeListings = eligibility.activeListings;
    totalSalesCents = eligibility.totalSalesCents;
    longCaseCount = eligibility.longCaseCount;
    accountAgeDays = eligibility.accountAgeDays;
    profileComplete =
      !!(fullSeller.bio?.trim()) &&
      !!fullSeller.avatarImageUrl &&
      !!(fullSeller.returnPolicy || fullSeller.customOrderPolicy || fullSeller.shippingPolicy);
  }

  const criteriaListingsMet = activeListings >= REQUIRED_LISTINGS;
  const criteriaSalesMet = totalSalesCents >= REQUIRED_SALES_CENTS;
  const criteriaAgeMet = accountAgeDays >= REQUIRED_ACCOUNT_DAYS;
  const criteriaCasesMet = longCaseCount === 0;
  const allCriteriaMet = criteriaListingsMet && criteriaSalesMet && criteriaAgeMet && criteriaCasesMet;

  // ── Server actions ─────────────────────────────────────────────────────────
  async function applyForGuildMember(formData: FormData) {
    "use server";
    const { seller: s } = await ensureSeller();
    const craftDescription = truncateText(String(formData.get("craftDescription") ?? "").trim(), 500);
    const yearsExperience = parseInt(String(formData.get("yearsExperience") ?? "0"), 10);
    const portfolioRaw = String(formData.get("portfolioUrl") ?? "").trim();
    const portfolioUrl = portfolioRaw ? normalizeHttpsUrl(portfolioRaw) : null;
    const confirmHandmade = formData.get("confirmHandmade") === "on";
    if (!craftDescription || !Number.isFinite(yearsExperience) || yearsExperience < 0 || yearsExperience > 100 || !confirmHandmade) return;
    if (portfolioRaw && !portfolioUrl) return;

    const current = await prisma.sellerProfile.findUnique({
      where: { id: s.id },
      select: {
        userId: true,
        guildLevel: true,
        makerVerification: { select: { status: true } },
        user: { select: { createdAt: true } },
      },
    });
    if (!current || current.guildLevel !== "NONE" || current.makerVerification?.status === "PENDING") {
      redirect("/dashboard/verification");
    }
    const eligibility = await getGuildMemberEligibility({
      sellerProfileId: s.id,
      sellerUserId: current.userId,
      accountCreatedAt: current.user?.createdAt,
    });
    if (!(eligibility.criteriaListingsMet && eligibility.criteriaSalesMet && eligibility.criteriaAgeMet && eligibility.criteriaCasesMet)) {
      redirect("/dashboard/verification");
    }

    await prisma.makerVerification.upsert({
      where: { sellerProfileId: s.id },
      create: {
        sellerProfileId: s.id,
        craftDescription,
        yearsExperience,
        portfolioUrl,
        status: "PENDING",
      },
      update: {
        craftDescription,
        yearsExperience,
        portfolioUrl,
        status: "PENDING",
        reviewedById: null,
        reviewNotes: null,
        reviewedAt: null,
        appliedAt: new Date(),
      },
    });

    redirect("/dashboard/verification");
  }

  async function applyForGuildMaster(formData: FormData) {
    "use server";
    const { seller: s } = await ensureSeller();
    const craftBusiness = truncateText(String(formData.get("craftBusiness") ?? "").trim(), 500);
    const portfolioRaw = String(formData.get("portfolioUrl") ?? "").trim();
    const portfolioUrl = portfolioRaw ? normalizeHttpsUrl(portfolioRaw) : null;
    const confirmStandards = formData.get("confirmStandards") === "on";
    if (!craftBusiness || !confirmStandards) return;
    if (portfolioRaw && !portfolioUrl) return;

    const current = await prisma.sellerProfile.findUnique({
      where: { id: s.id },
      select: {
        guildLevel: true,
        makerVerification: { select: { status: true } },
      },
    });
    if (!current || current.guildLevel !== "GUILD_MEMBER" || current.makerVerification?.status === "GUILD_MASTER_PENDING") {
      redirect("/dashboard/verification");
    }
    const metrics = await calculateSellerMetrics(s.id);
    const criteria = meetsGuildMasterRequirements(metrics);
    if (!criteria.allMet) redirect("/dashboard/verification");

    await prisma.$transaction([
      prisma.makerVerification.update({
        where: { sellerProfileId: s.id },
        data: {
          status: "GUILD_MASTER_PENDING",
          guildMasterCraftBusiness: craftBusiness,
          portfolioUrl: portfolioUrl ?? undefined,
          appliedAt: new Date(),
        },
      }),
      prisma.sellerProfile.update({
        where: { id: s.id },
        data: {
          guildMasterAppliedAt: new Date(),
          guildMasterReviewNotes: null,
        },
      }),
    ]);

    redirect("/dashboard/verification");
  }

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-10">
      <div>
        <h1 className="text-2xl font-bold">Guild Verification Program</h1>
        <p className="text-neutral-600 mt-1 text-sm">
          Guild badges appear on your profile and listings to signal trust and performance to buyers.
        </p>
      </div>

      {/* ── Section A: Guild Member ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Guild Member</h2>
          <GuildBadge level="GUILD_MEMBER" showLabel={true} size={28} />
        </div>
        <p className="text-sm text-neutral-600">
          Profile reviewed and approved by the Grainline team.
        </p>

        {isMemberActive && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-6 py-4">
            <div className="flex items-center gap-2 text-green-800 font-semibold">
              <span>✓</span>
              <span>Active — Guild Member</span>
            </div>
            {fullSeller.guildMemberApprovedAt && (
              <p className="text-green-700 text-xs mt-1">
                Approved on{" "}
                {new Date(fullSeller.guildMemberApprovedAt).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            )}
          </div>
        )}

        {isMemberPending && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-4">
            <div className="flex items-center gap-2 text-amber-800 font-semibold">
              <span>⏳</span>
              <span>Under Review</span>
            </div>
            <p className="text-amber-700 text-sm mt-1">
              We&apos;ll review your application and get back to you shortly.
            </p>
          </div>
        )}

        {!isMemberActive && !isMemberPending && (
          <>
            {/* Badge revocation notice — shown when they previously held a badge */}
            {guildLevel === "NONE" && fullSeller.guildMemberApprovedAt && !isMemberRejected && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <span className="font-medium">Your Guild badge was revoked.</span>{" "}
                You can re-apply when you meet all requirements below.
              </div>
            )}

            {isMemberRejected && verification?.reviewNotes && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <span className="font-medium">Your Guild badge was revoked.</span>{" "}
                {verification.reviewNotes} You can re-apply when you meet all requirements.
              </div>
            )}
            {isMemberRejected && !verification?.reviewNotes && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                Your Guild badge was revoked. You can re-apply when you meet all requirements.
              </div>
            )}

            {/* ── Eligibility checklist ── */}
            <div className="card-section p-5 space-y-3">
              <p className="text-sm font-semibold text-neutral-800">Requirements</p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <span className={criteriaListingsMet ? "text-green-600" : "text-red-500"}>{criteriaListingsMet ? "✓" : "✗"}</span>
                  <span className={criteriaListingsMet ? "text-green-800" : "text-neutral-700"}>
                    Active listings:{" "}
                    <span className="font-medium">{activeListings}</span> /{" "}
                    <span className="text-neutral-500">{REQUIRED_LISTINGS} required</span>
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className={criteriaSalesMet ? "text-green-600" : "text-red-500"}>{criteriaSalesMet ? "✓" : "✗"}</span>
                  <span className={criteriaSalesMet ? "text-green-800" : "text-neutral-700"}>
                    Completed sales:{" "}
                    <span className="font-medium">
                      {(totalSalesCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}
                    </span> /{" "}
                    <span className="text-neutral-500">$250 required</span>
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className={criteriaAgeMet ? "text-green-600" : "text-red-500"}>{criteriaAgeMet ? "✓" : "✗"}</span>
                  <span className={criteriaAgeMet ? "text-green-800" : "text-neutral-700"}>
                    Account age:{" "}
                    <span className="font-medium">{accountAgeDays} days</span> /{" "}
                    <span className="text-neutral-500">{REQUIRED_ACCOUNT_DAYS} days required</span>
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className={criteriaCasesMet ? "text-green-600" : "text-red-500"}>{criteriaCasesMet ? "✓" : "✗"}</span>
                  <span className={criteriaCasesMet ? "text-green-800" : "text-neutral-700"}>
                    {criteriaCasesMet
                      ? "No long-running unresolved cases"
                      : `${longCaseCount} case${longCaseCount !== 1 ? "s" : ""} open longer than 60 days`}
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className={profileComplete ? "text-green-600" : "text-amber-500"}>{profileComplete ? "✓" : "○"}</span>
                  <span className="text-neutral-600 text-xs">
                    Profile complete (bio, photo, shop policy) —{" "}
                    <span className="italic">recommended before applying</span>
                  </span>
                </li>
              </ul>

              {!allCriteriaMet && (
                <p className="text-xs text-neutral-500 border-t border-neutral-100 pt-3">
                  Complete the requirements above to unlock your Guild Member application.
                </p>
              )}
            </div>

            {allCriteriaMet && (
              <form action={applyForGuildMember} className="space-y-5 card-section p-6">
                <div className="space-y-1.5">
                  <label htmlFor="craftDescription" className="block text-sm font-medium">
                    About your craft <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="craftDescription"
                    name="craftDescription"
                    required
                    maxLength={500}
                    rows={4}
                    defaultValue={verification?.craftDescription ?? ""}
                    placeholder="Describe your woodworking practice — what you make, your techniques, and what makes your work special."
                    className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
                  />
                  <p className="text-xs text-neutral-500">Max 500 characters</p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="yearsExperience" className="block text-sm font-medium">
                    Years making woodworking pieces <span className="text-red-500">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="yearsExperience"
                      name="yearsExperience"
                      type="number"
                      required
                      min={0}
                      max={100}
                      defaultValue={verification?.yearsExperience ?? ""}
                      placeholder="0"
                      className="w-24 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
                    />
                    <span className="text-sm text-neutral-600">years</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="portfolioUrl" className="block text-sm font-medium">
                    Instagram or website showing your work
                  </label>
                  <input
                    id="portfolioUrl"
                    name="portfolioUrl"
                    type="url"
                    defaultValue={verification?.portfolioUrl ?? ""}
                    placeholder="https://instagram.com/yourhandle"
                    className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
                  />
                </div>

                <div className="flex items-start gap-2">
                  <input id="confirmHandmade" name="confirmHandmade" type="checkbox" required className="mt-0.5" />
                  <label htmlFor="confirmHandmade" className="text-sm text-neutral-700">
                    I confirm all items I list are handmade by me{" "}
                    <span className="text-red-500">*</span>
                  </label>
                </div>

                <button
                  type="submit"
                  className="rounded-lg bg-amber-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-amber-700"
                >
                  Apply for Guild Member Badge
                </button>
              </form>
            )}
          </>
        )}
      </section>

      {/* ── Section B: Guild Master (only if at least Guild Member) ── */}
      {showSectionB && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Guild Master</h2>
            <GuildBadge level="GUILD_MASTER" showLabel={true} size={28} />
          </div>
          <p className="text-sm text-neutral-600">
            Our highest tier — awarded for sustained performance, ratings, and responsiveness.
          </p>

          {/* Requirements + live metrics */}
          {!isMasterActive && masterMetrics && masterCriteria && (
            <div className="card-section p-5 space-y-3">
              <p className="text-sm font-semibold text-neutral-800">Requirements</p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <span className={masterCriteria.ratingMet ? "text-green-600" : "text-red-500"}>{masterCriteria.ratingMet ? "✓" : "✗"}</span>
                  <span className={masterCriteria.ratingMet ? "text-green-800" : "text-neutral-700"}>
                    Average rating:{" "}
                    <span className="font-medium">{masterMetrics.averageRating.toFixed(1)} ★</span>
                    {" "}/ <span className="text-neutral-500">{GUILD_MASTER_REQUIREMENTS.averageRating}+ required</span>
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className={masterCriteria.reviewsMet ? "text-green-600" : "text-red-500"}>{masterCriteria.reviewsMet ? "✓" : "✗"}</span>
                  <span className={masterCriteria.reviewsMet ? "text-green-800" : "text-neutral-700"}>
                    Reviews:{" "}
                    <span className="font-medium">{masterMetrics.reviewCount}</span>
                    {" "}/ <span className="text-neutral-500">{GUILD_MASTER_REQUIREMENTS.reviewCount}+ required</span>
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className={masterCriteria.shippingMet ? "text-green-600" : "text-red-500"}>{masterCriteria.shippingMet ? "✓" : "✗"}</span>
                  <span className={masterCriteria.shippingMet ? "text-green-800" : "text-neutral-700"}>
                    On-time shipping:{" "}
                    <span className="font-medium">{(masterMetrics.onTimeShippingRate * 100).toFixed(0)}%</span>
                    {" "}/ <span className="text-neutral-500">{GUILD_MASTER_REQUIREMENTS.onTimeShippingRate * 100}%+ required</span>
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className={masterCriteria.responseMet ? "text-green-600" : "text-red-500"}>{masterCriteria.responseMet ? "✓" : "✗"}</span>
                  <span className={masterCriteria.responseMet ? "text-green-800" : "text-neutral-700"}>
                    Response rate:{" "}
                    <span className="font-medium">{(masterMetrics.responseRate * 100).toFixed(0)}%</span>
                    {" "}/ <span className="text-neutral-500">{GUILD_MASTER_REQUIREMENTS.responseRate * 100}%+ required</span>
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className={masterCriteria.ageMet ? "text-green-600" : "text-red-500"}>{masterCriteria.ageMet ? "✓" : "✗"}</span>
                  <span className={masterCriteria.ageMet ? "text-green-800" : "text-neutral-700"}>
                    Account age:{" "}
                    <span className="font-medium">{masterMetrics.accountAgeDays} days</span>
                    {" "}/ <span className="text-neutral-500">{GUILD_MASTER_REQUIREMENTS.accountAgeDays} days required</span>
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className={masterCriteria.salesMet ? "text-green-600" : "text-red-500"}>{masterCriteria.salesMet ? "✓" : "✗"}</span>
                  <span className={masterCriteria.salesMet ? "text-green-800" : "text-neutral-700"}>
                    Completed sales:{" "}
                    <span className="font-medium">
                      {(masterMetrics.totalSalesCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}
                    </span>
                    {" "}/ <span className="text-neutral-500">$1,000 required</span>
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className={masterCriteria.casesMet ? "text-green-600" : "text-red-500"}>{masterCriteria.casesMet ? "✓" : "✗"}</span>
                  <span className={masterCriteria.casesMet ? "text-green-800" : "text-neutral-700"}>
                    {masterCriteria.casesMet
                      ? "No open disputes"
                      : `${masterMetrics.activeCaseCount} unresolved dispute${masterMetrics.activeCaseCount !== 1 ? "s" : ""}`}
                  </span>
                </li>
              </ul>
              {!masterCriteria.allMet && (
                <p className="text-xs text-neutral-500 border-t border-neutral-100 pt-3">
                  Meet all requirements above to unlock the Guild Master application.
                </p>
              )}
              <p className="text-xs text-indigo-700 border-t border-neutral-100 pt-3">
                Guild Master status is subject to ongoing review and may be revoked if standards are not maintained.
              </p>
            </div>
          )}
          {!isMasterActive && !masterMetrics && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-5 py-4 text-sm space-y-2">
              <p className="font-medium text-indigo-900">Requirements</p>
              <ul className="text-indigo-800 space-y-1 text-xs list-disc list-inside">
                <li>4.5+ star average rating</li>
                <li>25+ verified reviews</li>
                <li>95% on-time shipping</li>
                <li>90% message response rate</li>
                <li>6+ months on the platform</li>
                <li>$1,000 in completed sales</li>
                <li>No open disputes</li>
              </ul>
            </div>
          )}

          {isMasterActive && (
            <>
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-6 py-4">
                <div className="flex items-center gap-2 text-indigo-800 font-semibold">
                  <span>◆</span>
                  <span>Active — Guild Master</span>
                </div>
                {fullSeller.guildMasterApprovedAt && (
                  <p className="text-indigo-700 text-xs mt-1">
                    Approved on{" "}
                    {new Date(fullSeller.guildMasterApprovedAt).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                )}
              </div>

              {/* ── Metrics warning banner (shown if first failure recorded) ── */}
              {fullSeller.metricWarningSentAt && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 space-y-1">
                  <p className="text-amber-900 font-semibold text-sm">⚠ Your Guild Master metrics are below requirements</p>
                  <p className="text-amber-800 text-xs">
                    Improve your metrics before{" "}
                    <strong>
                      {new Date(
                        new Date(fullSeller.metricWarningSentAt).getTime() + 30 * 24 * 60 * 60 * 1000
                      ).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </strong>{" "}
                    to maintain your badge. If metrics remain below standard at the next monthly review your Guild Master status will be revoked (Guild Member remains active).
                  </p>
                </div>
              )}

              {/* ── Last check / next check info ── */}
              <div className="card-section px-5 py-3 text-xs text-neutral-500 space-y-1">
                {fullSeller.lastMetricCheckAt ? (
                  <p>
                    Last metrics check:{" "}
                    <span className="text-neutral-700 font-medium">
                      {new Date(fullSeller.lastMetricCheckAt).toLocaleDateString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </p>
                ) : (
                  <p>Metrics have not yet been checked — first check runs on the 1st of next month.</p>
                )}
                <p>Next scheduled check: <span className="text-neutral-700 font-medium">1st of next month</span></p>
              </div>
            </>
          )}

          {isMasterPending && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-4">
              <div className="flex items-center gap-2 text-amber-800 font-semibold">
                <span>⏳</span>
                <span>Under Review</span>
              </div>
              <p className="text-amber-700 text-sm mt-1">
                Your Guild Master application is under review.
              </p>
            </div>
          )}

          {/* ── Last check info (for Guild Members not yet Guild Master) ── */}
          {!isMasterActive && fullSeller.lastMetricCheckAt && (
            <div className="card-section px-5 py-3 text-xs text-neutral-500">
              Last metrics check:{" "}
              <span className="text-neutral-700 font-medium">
                {new Date(fullSeller.lastMetricCheckAt).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              {" "}· Next check: <span className="text-neutral-700 font-medium">1st of next month</span>
            </div>
          )}

          {!isMasterActive && !isMasterPending && (
            <>
              {isMasterRejected && fullSeller.guildMasterReviewNotes && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  <span className="font-medium">Guild Master application not approved.</span>{" "}
                  {fullSeller.guildMasterReviewNotes}
                </div>
              )}
              {isMasterRejected && !fullSeller.guildMasterReviewNotes && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  Your previous Guild Master application was not approved. You may reapply once you meet all requirements.
                </div>
              )}

              {masterCriteria && !masterCriteria.allMet && null /* form hidden until requirements met */}

              {(!masterCriteria || masterCriteria.allMet) && (
              <form action={applyForGuildMaster} className="space-y-5 card-section p-6">
                <div className="space-y-1.5">
                  <label htmlFor="craftBusiness" className="block text-sm font-medium">
                    Describe your craft business <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="craftBusiness"
                    name="craftBusiness"
                    required
                    maxLength={500}
                    rows={4}
                    placeholder="Tell us about your business — volume, consistency, how you maintain quality at scale."
                    className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="gmPortfolioUrl" className="block text-sm font-medium">
                    Link to portfolio or social proof
                  </label>
                  <input
                    id="gmPortfolioUrl"
                    name="portfolioUrl"
                    type="url"
                    defaultValue={verification?.portfolioUrl ?? ""}
                    placeholder="https://instagram.com/yourhandle"
                    className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
                  />
                </div>

                <div className="flex items-start gap-2">
                  <input id="confirmStandards" name="confirmStandards" type="checkbox" required className="mt-0.5" />
                  <label htmlFor="confirmStandards" className="text-sm text-neutral-700">
                    I agree to maintain Grainline&apos;s performance standards and understand my badge
                    may be revoked if I fall below them <span className="text-red-500">*</span>
                  </label>
                </div>

                <button
                  type="submit"
                  className="rounded-lg bg-indigo-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-600"
                >
                  Apply for Guild Master Badge
                </button>
              </form>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}
