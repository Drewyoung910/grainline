// src/app/account/settings/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUser } from "@/lib/ensureUser";
import { NotificationToggle } from "@/components/NotificationToggle";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Notification Preferences",
};

export default async function AccountSettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/account/settings");

  const me = await ensureUser();
  if (!me) redirect("/sign-in?redirect_url=/account/settings");

  const user = await prisma.user.findUnique({
    where: { id: me.id },
    select: {
      notificationPreferences: true,
      sellerProfile: { select: { id: true } },
    },
  });

  const prefs = (user?.notificationPreferences as Record<string, boolean>) ?? {};
  const hasSeller = !!user?.sellerProfile;

  function isEnabled(type: string) {
    return prefs[type] !== false;
  }

  function Row({ type, label, description }: { type: string; label: string; description: string }) {
    return (
      <div className="flex items-center justify-between py-3 border-b border-neutral-100 last:border-0">
        <div>
          <p className="text-sm font-medium text-neutral-800">{label}</p>
          <p className="text-xs text-neutral-400 mt-0.5">{description}</p>
        </div>
        <NotificationToggle type={type} enabled={isEnabled(type)} />
      </div>
    );
  }

  return (
    <main className="max-w-2xl mx-auto p-6 md:p-8 space-y-8">
      <header>
        <h1 className="text-3xl font-bold">Notification Preferences</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Choose which notifications you receive from Grainline.
        </p>
      </header>

      {/* Group 1 — From Makers You Follow */}
      <section className="border border-neutral-200 p-5">
        <h2 className="text-base font-semibold mb-3">From Makers You Follow</h2>
        <Row
          type="FOLLOWED_MAKER_NEW_LISTING"
          label="New listings"
          description="When a maker you follow adds a new piece"
        />
        <Row
          type="FOLLOWED_MAKER_NEW_BLOG"
          label="New blog posts"
          description="When a maker you follow publishes a new story"
        />
        <Row
          type="SELLER_BROADCAST"
          label="Shop updates"
          description="Broadcasts and announcements from makers you follow"
        />
      </section>

      {/* Group 2 — Your Account */}
      <section className="border border-neutral-200 p-5">
        <h2 className="text-base font-semibold mb-3">Your Account</h2>
        {hasSeller && (
          <Row
            type="NEW_FOLLOWER"
            label="Someone follows your shop"
            description="When a buyer or maker starts following you"
          />
        )}
        <Row
          type="COMMISSION_INTEREST"
          label="Commission interest"
          description="When a maker expresses interest in your commission request"
        />
        <Row
          type="NEW_ORDER"
          label="Order updates"
          description="Order confirmations, shipping updates, and delivery notices"
        />
      </section>

      {/* Group 3 — Sellers only */}
      {hasSeller && (
        <section className="border border-neutral-200 p-5">
          <h2 className="text-base font-semibold mb-3">Your Shop</h2>
          <Row
            type="NEW_REVIEW"
            label="New reviews"
            description="When a buyer leaves a review on one of your listings"
          />
          <Row
            type="NEW_MESSAGE"
            label="New messages"
            description="When someone sends you a message"
          />
        </section>
      )}

      <p className="text-xs text-neutral-400">
        Changes take effect immediately. Some critical notifications (security,
        account issues) cannot be disabled.
      </p>
    </main>
  );
}
