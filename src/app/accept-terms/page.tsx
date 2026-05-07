import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { safeInternalPath, signInPathForRedirect } from "@/lib/internalReturnUrl";
import { hasAcceptedCurrentTerms } from "@/lib/termsAcceptance";
import AcceptTermsForm from "./AcceptTermsForm";

export const metadata = {
  title: "Accept Terms",
  robots: { index: false, follow: false },
};

export default async function AcceptTermsPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
}) {
  const params = await searchParams;
  const redirectUrl = safeInternalPath(params.redirect_url, "/account");
  const { userId } = await auth();

  if (!userId) {
    redirect(signInPathForRedirect(`/accept-terms?redirect_url=${encodeURIComponent(redirectUrl)}`, "/accept-terms"));
  }

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: {
      termsAcceptedAt: true,
      termsVersion: true,
      ageAttestedAt: true,
    },
  });

  if (hasAcceptedCurrentTerms(user)) {
    redirect(redirectUrl);
  }

  return (
    <main className="min-h-[100svh] bg-[#F7F5F0] px-6 py-12">
      <section className="mx-auto max-w-lg card-section p-6">
        <p className="text-sm text-neutral-500">Before you continue</p>
        <h1 className="mt-1 text-2xl font-semibold font-display">Review Grainline&apos;s terms</h1>
        <p className="mt-4 text-sm leading-6 text-neutral-700">
          Grainline requires acceptance of the current Terms of Service, Privacy Policy, and age
          confirmation before account features are available.
        </p>
        <div className="mt-5 rounded-md border border-neutral-200 bg-white p-4 text-sm leading-6 text-neutral-700">
          <p>
            By continuing, you confirm that you have reviewed and agree to the{" "}
            <Link href="/terms" className="underline hover:text-neutral-900" target="_blank" rel="noopener noreferrer">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline hover:text-neutral-900" target="_blank" rel="noopener noreferrer">
              Privacy Policy
            </Link>
            , and that you are at least 18 years old.
          </p>
        </div>
        <AcceptTermsForm redirectUrl={redirectUrl} />
      </section>
    </main>
  );
}
