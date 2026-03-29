// src/app/admin/verification/page.tsx
import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createNotification } from "@/lib/notifications";
import { sendVerificationApproved, sendVerificationRejected } from "@/lib/email";

async function approveApplication(verificationId: string) {
  "use server";
  const { userId } = await auth();
  if (!userId) redirect("/");
  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true, role: true } });
  if (!me || (me.role !== "EMPLOYEE" && me.role !== "ADMIN")) redirect("/");

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
      data: { status: "APPROVED", reviewedById: me.id, reviewedAt: new Date() },
    }),
    prisma.sellerProfile.update({
      where: { id: verification.sellerProfileId },
      data: { isVerifiedMaker: true, verifiedAt: new Date() },
    }),
  ]);

  await createNotification({
    userId: verification.sellerProfile.userId,
    type: "VERIFICATION_APPROVED",
    title: "You are now a Verified Maker!",
    body: "Your badge is live on your profile",
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

  revalidatePath("/admin/verification");
}

async function rejectApplication(formData: FormData) {
  "use server";
  const { userId } = await auth();
  if (!userId) redirect("/");
  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true, role: true } });
  if (!me || (me.role !== "EMPLOYEE" && me.role !== "ADMIN")) redirect("/");

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
      title: "Verification update",
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

  revalidatePath("/admin/verification");
}

export default async function AdminVerificationPage() {
  const pending = await prisma.makerVerification.findMany({
    where: { status: "PENDING" },
    orderBy: { appliedAt: "asc" },
    include: {
      sellerProfile: {
        select: { displayName: true, id: true },
      },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Maker Verification Queue</h1>
        <p className="text-neutral-600 text-sm mt-1">
          {pending.length} pending application{pending.length !== 1 ? "s" : ""}
        </p>
      </div>

      {pending.length === 0 ? (
        <div className="rounded-xl border p-8 text-neutral-500 text-sm">
          No pending applications.
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((v) => (
            <div key={v.id} className="rounded-xl border bg-white p-6 space-y-4">
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
                      <a
                        href={v.portfolioUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 underline break-all hover:text-blue-800"
                      >
                        {v.portfolioUrl}
                      </a>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-start gap-3 pt-2 border-t">
                {/* Approve */}
                <form action={approveApplication.bind(null, v.id)}>
                  <button
                    type="submit"
                    className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-600"
                  >
                    Approve
                  </button>
                </form>

                {/* Reject with optional notes */}
                <form action={rejectApplication} className="flex items-start gap-2 flex-wrap">
                  <input type="hidden" name="verificationId" value={v.id} />
                  <input
                    name="reviewNotes"
                    type="text"
                    placeholder="Rejection notes (optional)"
                    className="rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300 w-56"
                  />
                  <button
                    type="submit"
                    className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                  >
                    Reject
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
