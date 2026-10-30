import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import { acceptTermsPathForRedirect, safeInternalPath, signInPathForRedirect } from "@/lib/internalReturnUrl";

export const metadata: Metadata = {
  title: "Create your account",
  robots: { index: false, follow: false },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
}) {
  const params = await searchParams;
  const redirectUrl = safeInternalPath(params.redirect_url, "/");
  const postAuthUrl = acceptTermsPathForRedirect(redirectUrl);

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-[#F7F5F0] p-8">
      <SignUp
        path="/sign-up"
        routing="path"
        signInUrl={signInPathForRedirect(postAuthUrl)}
        forceRedirectUrl={postAuthUrl}
        fallbackRedirectUrl={postAuthUrl}
        appearance={{
          variables: {
            colorPrimary: "#2C1F1A",
            colorBackground: "#ffffff",
            fontFamily: "inherit",
            borderRadius: "0.375rem",
          },
        }}
      />
    </main>
  );
}
