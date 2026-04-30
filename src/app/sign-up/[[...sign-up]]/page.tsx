import { safeInternalPath } from "@/lib/internalReturnUrl";
import SignUpTermsGate from "./SignUpTermsGate";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
}) {
  const params = await searchParams;
  const redirectUrl = safeInternalPath(params.redirect_url, "/");
  return <SignUpTermsGate redirectUrl={redirectUrl} />;
}
