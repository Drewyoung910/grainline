// src/app/dashboard/verification/page.tsx
import { redirect } from "next/navigation";
import { ensureSeller } from "@/lib/ensureSeller";
import { prisma } from "@/lib/db";

export default async function VerificationPage() {
  const { seller } = await ensureSeller();
  if (!seller) redirect("/sign-in");

  const verification = await prisma.makerVerification.findUnique({
    where: { sellerProfileId: seller.id },
  });

  // Already verified
  if (seller.isVerifiedMaker) {
    return (
      <main className="max-w-2xl mx-auto p-8">
        <div className="rounded-xl border border-green-200 bg-green-50 px-6 py-5">
          <div className="flex items-center gap-2 text-green-800 font-semibold text-lg">
            <span>✓</span>
            <span>You are a Verified Maker</span>
          </div>
          <p className="text-green-700 text-sm mt-1">
            Your Verified Maker badge is displayed on your public profile and listings.
          </p>
        </div>
      </main>
    );
  }

  // Application pending
  if (verification && verification.status === "PENDING") {
    return (
      <main className="max-w-2xl mx-auto p-8">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-5">
          <div className="flex items-center gap-2 text-amber-800 font-semibold text-lg">
            <span>⏳</span>
            <span>Your application is under review</span>
          </div>
          <p className="text-amber-700 text-sm mt-1">
            We&apos;ll review your application and get back to you shortly.
          </p>
        </div>
      </main>
    );
  }

  const isRejected = verification?.status === "REJECTED";

  // Application form (not applied, or rejected)
  async function applyForVerification(formData: FormData) {
    "use server";
    const { seller: s } = await ensureSeller();

    const craftDescription = String(formData.get("craftDescription") ?? "").trim().slice(0, 500);
    const yearsExperience = parseInt(String(formData.get("yearsExperience") ?? "0"), 10);
    const portfolioUrl = String(formData.get("portfolioUrl") ?? "").trim() || null;

    if (!craftDescription || !Number.isFinite(yearsExperience)) return;

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

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Apply for Verified Maker Badge</h1>
        <p className="text-neutral-600 mt-1 text-sm">
          Verified Makers have confirmed their work is handmade. Your badge will appear on your profile and listings.
        </p>
      </div>

      {isRejected && verification?.reviewNotes && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-medium">Previous application was not approved.</span>{" "}
          {verification.reviewNotes}
        </div>
      )}
      {isRejected && !verification?.reviewNotes && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Your previous application was not approved. You may reapply below.
        </div>
      )}

      <form action={applyForVerification} className="space-y-5">
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
            How long have you been making? <span className="text-red-500">*</span>
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
          <input
            id="confirm"
            name="confirm"
            type="checkbox"
            required
            className="mt-0.5"
          />
          <label htmlFor="confirm" className="text-sm text-neutral-700">
            I confirm all items I list are handmade by me <span className="text-red-500">*</span>
          </label>
        </div>

        <button
          type="submit"
          className="rounded-lg bg-amber-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-amber-700"
        >
          Apply for Verified Maker Badge
        </button>
      </form>
    </main>
  );
}
