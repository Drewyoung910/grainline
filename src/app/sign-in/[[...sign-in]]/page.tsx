import { SignIn } from "@clerk/nextjs";
import { safeInternalPath, signUpPathForRedirect } from "@/lib/internalReturnUrl";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
}) {
  const params = await searchParams;
  const redirectUrl = safeInternalPath(params.redirect_url, "/");

  return (
    <main className="min-h-[100svh] bg-[#F7F5F0] flex items-center justify-center p-8">
      <SignIn
        routing="hash"
        forceRedirectUrl={redirectUrl}
        fallbackRedirectUrl={redirectUrl}
        signUpUrl={signUpPathForRedirect(redirectUrl)}
        appearance={{
          variables: {
            colorBackground: "#ffffff",
            colorPrimary: "#171717",
            borderRadius: "0.5rem",
          },
          elements: {
            cardBox: "shadow-sm border border-neutral-200",
            headerTitle: "font-display text-neutral-950",
            formButtonPrimary: "rounded-md bg-neutral-900 hover:bg-neutral-800",
          },
        }}
      />
    </main>
  );
}
