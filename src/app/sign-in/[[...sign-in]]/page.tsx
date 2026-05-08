import { SignIn } from "@clerk/nextjs";
import { acceptTermsPathForRedirect, safeInternalPath, signUpPathForRedirect } from "@/lib/internalReturnUrl";

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
      <SignIn
        routing="hash"
        forceRedirectUrl={postAuthUrl}
        fallbackRedirectUrl={postAuthUrl}
        signUpUrl={signUpPathForRedirect(redirectUrl)}
      />
    </main>
  );
}
