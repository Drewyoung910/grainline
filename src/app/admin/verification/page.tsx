// src/app/admin/verification/page.tsx
import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createNotification } from "@/lib/notifications";
import { sendVerificationApproved, sendVerificationRejected } from "@/lib/email";
import { calculateSellerMetrics, meetsGuildMasterRequirements, GUILD_MASTER_REQUIREMENTS, type SellerMetricsResult } from "@/lib/metrics";
import { FeatureMakerButton } from "@/components/admin/FeatureMakerButton";
import { logAdminAction } from "@/lib/audit";

// ── Shared auth helper ──────────────────────────────────────────────────────
async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) redirect("/");
  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true, role: true } });
  if (!me || (me.role !== "EMPLOYEE" && me.role !== "ADMIN")) redirect("/");
  return me;
}

// ── Guild Member actions ────────────────────────────────────────────────────
async function approveGuildMember(formData: FormData) {
  "use server";
  const me = await requireAdmin();
  const verificationId = String(formData.get("verificationId") ?? "");
  const adminOverride = formData.get("adminOverride") === "on";

  const verification = await prisma.makerVerification.findUnique({
    where: { id: verificationId },
    select: {
      sellerProfileId: true,
      sellerProfile: {
        select: { userId: true, id: true, displayName: true, user: { select: { email: true } } },
      },
    },
  });
  if (!verification) return;

  await prisma.$transaction([
    prisma.makerVerification.update({
      where: { id: verificationId },
      data: {
        status: "APPROVED",
        reviewedById: me.id,
        reviewedAt: new Date(),
        reviewNotes: adminOverride ? "Admin override: $250 sales requirement waived" : null,
      },
    }),
    prisma.sellerProfile.update({
      where: { id: verification.sellerProfileId },
      data: { isVerifiedMaker: true, verifiedAt: new Date(), guildLevel: "GUILD_MEMBER", guildMemberApprovedAt: new Date() },
    }),
  ]);

  await createNotification({
    userId: verification.sellerProfile.userId,
    type: "VERIFICATION_APPROVED",
    title: "You are now a Guild Member!",
    body: "Your Guild Member badge is now live on your profile",
    link: `/seller/${verification.sellerProfile.id}`,
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
}

async function rejectGuildMember(formData: FormData) {
  "use server";
  const me = await requireAdmin();
  const verificationId = String(formData.get("verificationId") ?? "");
  const reviewNotes = String(formData.get("reviewNotes") ?? "").trim() || null;

  const verification = await prisma.makerVerification.findUnique({
    where: { id: verificationId },
    select: {
      sellerProfile: {
        select: { userId: true, displayName: true, user: { select: { email: true } } },
      },
    },
  });

  await prisma.makerVerification.update({
    where: { id: verificationId },
    data: { status: "REJECTED", reviewedById: me.id, reviewedAt: new Date(), reviewNotes },
  });

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

  await prisma.sellerProfile.update({
    where: { id: sellerProfileId },
    data: { guildLevel: "NONE", isVerifiedMaker: false },
  });

  await logAdminAction({ adminId: me.id, action: "REVOKE_GUILD_MEMBER", targetType: "SELLER_PROFILE", targetId: sellerProfileId });

  revalidatePath("/admin/verification");
}

// ── Guild Master actions ─────────────────────────────────────────────────────
async function approveGuildMaster(verificationId: string) {
  "use server";
  const me = await requireAdmin();

  const verification = await prisma.makerVerification.findUnique({
    where: { id: verificationId },
    select: {
      sellerProfileId: true,
      sellerProfile: {
        select: { userId: true, id: true, displayName: true, user: { select: { email: true } } },
      },
    },
  });
  if (!verification) return;

  await prisma.$transaction([
    prisma.makerVerification.update({
      where: { id: verificationId },
      data: { status: "GUILD_MASTER_APPROVED", reviewedById: me.id, reviewedAt: new Date() },
    }),
    prisma.sellerProfile.update({
      where: { id: verification.sellerProfileId },
      data: { guildLevel: "GUILD_MASTER", guildMasterApprovedAt: new Date() },
    }),
  ]);

  await createNotification({
    userId: verification.sellerProfile.userId,
    type: "VERIFICATION_APPROVED",
    title: "You are now a Guild Master!",
    body: "Your Guild Master badge is now live on your profile",
    link: `/seller/${verification.sellerProfile.id}`,
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
}

async function rejectGuildMaster(formData: FormData) {
  "use server";
  const me = await requireAdmin();
  const verificationId = String(formData.get("verificationId") ?? "");
  const reviewNotes = String(formData.get("reviewNotes") ?? "").trim() || null;

  const verification = await prisma.makerVerification.findUnique({
    where: { id: verificationId },
    select: {
      sellerProfileId: true,
      sellerProfile: {
        select: { userId: true, displayName: true, user: { select: { email: true } } },
      },
    },
  });

  await prisma.$transaction([
    prisma.makerVerification.update({
      where: { id: verificationId },
      data: { status: "GUILD_MASTER_REJECTED", reviewedById: me.id, reviewedAt: new Date() },
    }),
    ...(verification ? [prisma.sellerProfile.update({
      where: { id: verification.sellerProfileId },
      data: { guildMasterReviewNotes: reviewNotes },
    })] : []),
  ]);

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

  await prisma.sellerProfile.update({
    where: { id: sellerProfileId },
    data: { guildLevel: "GUILD_MEMBER" },
  });

  await logAdminAction({ adminId: me.id, action: "REVOKE_GUILD_MASTER", targetType: "SELLER_PROFILE", targetId: sellerProfileId });

  revalidatePath("/admin/verification");
}

async function reinstateGuildMember(formData: FormData) {
  "use server";
  const me = await requireAdmin();
  const sellerProfileId = String(formData.get("sellerProfileId") ?? "");
  if (!sellerProfileId) return;

  await prisma.sellerProfile.update({
    where: { id: sellerProfileId },
    data: { guildLevel: "GUILD_MEMBER", isVerifiedMaker: true },
  });

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

  await prisma.sellerProfile.update({
    where: { id: sellerProfileId },
    data: { featuredUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  });

  await logAdminAction({
    adminId: me.id,
    action: "FEATURE_MAKER",
    targetType: "SellerProfile",
    targetId: sellerProfileId,
  });

  revalidatePath("/admin/verification");
  revalidatePath("/");
}

async function unfeatureMaker(sellerProfileId: string) {
  "use server";
  const me = await requireAdmin();

  await prisma.sellerProfile.update({
    where: { id: sellerProfileId },
    data: { featuredUntil: null },
  });

  await logAdminAction({
    adminId: me.id,
    action: "UNFEATURE_MAKER",
    targetType: "SellerProfile",
    targetId: sellerProfileId,
  });

  revalidatePath("/admin/verification");
  revalidatePath("/");
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
        sellerProfile: { select: { displayName: true, id: true, guildMasterAppliedAt: true } },
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

  // Fetch live metrics for each Guild Master applicant
  const masterMetricsMap = new Map<string, SellerMetricsResult>();
  await Promise.allSettled(
    masterPending.map(async (v) => {
      try {
        const m = await calculateSellerMetrics(v.sellerProfile.id);
        masterMetricsMap.set(v.id, m);
      } catch { /* non-fatal */ }
    })
  );

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
                      Applied {new Date(v.appliedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                  </div>
                  <a
                    href={`/seller/${v.sellerProfile.id}`}
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
                  <form action={approveGuildMember} className="flex flex-col gap-2">
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
                    <button type="submit" className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-600 self-start">
                      Approve Guild Member
                    </button>
                  </form>
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
                        ? new Date(v.sellerProfile.guildMasterAppliedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                        : "—"}
                    </div>
                  </div>
                  <a
                    href={`/seller/${v.sellerProfile.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs underline text-neutral-500 hover:text-neutral-700 shrink-0"
                  >
                    View profile ↗
                  </a>
                </div>

                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium text-neutral-700">Craft description:</span>
                    <p className="text-neutral-600 mt-0.5 whitespace-pre-wrap">{v.craftDescription}</p>
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

                {/* ── Live metrics dashboard ── */}
                {m && mc && (
                  <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-indigo-800 uppercase tracking-wide">Live Metrics</p>
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
                        { label: "Total Sales", value: (m.totalSalesCents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" }), req: "≥$1,000", met: mc.salesMet },
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
                    <p className="text-[10px] text-indigo-500 pt-1">Metrics calculated {m.calculatedAt.toLocaleDateString()} · {m.periodMonths}-month period</p>
                  </div>
                )}

                <div className="flex flex-wrap items-start gap-3 pt-2 border-t border-neutral-100">
                  <form action={approveGuildMaster.bind(null, v.id)}>
                    <button type="submit" className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600">
                      Approve Guild Master
                    </button>
                  </form>
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
                      Approved {new Date(s.guildMemberApprovedAt).toLocaleDateString()}
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
                      Approved {new Date(s.guildMasterApprovedAt).toLocaleDateString()}
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
                      Was approved {new Date(s.guildMemberApprovedAt).toLocaleDateString()}
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
