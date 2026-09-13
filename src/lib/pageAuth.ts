import { redirect } from "next/navigation";
import { ensureUser, isAccountAccessError } from "@/lib/ensureUser";

export async function ensureUserForPage(redirectUrl: string) {
  try {
    const me = await ensureUser();
    if (!me) redirect(`/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`);
    return me;
  } catch (error) {
    if (isAccountAccessError(error)) redirect("/banned");
    throw error;
  }
}
