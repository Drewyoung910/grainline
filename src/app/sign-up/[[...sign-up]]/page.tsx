import { SignUp } from "@clerk/nextjs";
import { acceptTermsPathForRedirect, safeInternalPath, signInPathForRedirect } from "@/lib/internalReturnUrl";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
}) {
  const params = await searchParams;
  const redirectUrl = safeInternalPath(params.redirect_url, "/");
  const postAuthUrl = acceptTermsPathForRedirect(redirectUrl);

  return (
    <main className="min-h-[100svh] flex items-center justify-center p-8">
      <SignUp
        routing="hash"
        signInUrl={signInPathForRedirect(postAuthUrl)}
        forceRedirectUrl={postAuthUrl}
        fallbackRedirectUrl={postAuthUrl}
      />
    </main>
  );
}
