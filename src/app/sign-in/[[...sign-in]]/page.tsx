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
    <main className="flex min-h-[100svh] items-center justify-center bg-[#F7F5F0] p-8">
      <SignIn
        path="/sign-in"
        routing="path"
        forceRedirectUrl={postAuthUrl}
        fallbackRedirectUrl={postAuthUrl}
        signUpUrl={signUpPathForRedirect(redirectUrl)}
      />
    </main>
  );
}
