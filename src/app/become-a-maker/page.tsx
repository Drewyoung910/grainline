import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { signUpPathForRedirect } from "@/lib/internalReturnUrl";

export const metadata = {
  title: "Become a Maker",
  robots: { index: false, follow: false },
};

export default async function BecomeAMakerPage() {
  const { userId } = await auth();
  redirect(userId ? "/dashboard" : signUpPathForRedirect("/dashboard"));
}
