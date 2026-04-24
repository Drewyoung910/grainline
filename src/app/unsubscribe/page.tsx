import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Email Preferences",
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage() {
  const { userId } = await auth();

  if (userId) {
    // Signed-in users go to their notification preferences
    redirect("/account/settings");
  }

  return (
    <main className="max-w-md mx-auto px-4 py-16 text-center space-y-6">
      <h1 className="text-2xl font-semibold font-display">Email Preferences</h1>
      <p className="text-sm text-neutral-600">
        Sign in to manage your email notification preferences.
      </p>
      <a
        href="/sign-in?redirect_url=/account/settings"
        className="inline-block rounded-md bg-neutral-900 text-white px-6 py-2.5 text-sm font-medium hover:bg-neutral-800"
      >
        Sign in to manage preferences
      </a>
      <p className="text-xs text-neutral-400">
        Transactional emails (order confirmations, shipping updates, refunds) cannot be disabled.
      </p>
    </main>
  );
}
