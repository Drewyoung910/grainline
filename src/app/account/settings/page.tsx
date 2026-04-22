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

const DEFAULT_OFF = [
  "SELLER_BROADCAST",
  "NEW_FAVORITE",
  "NEW_BLOG_COMMENT",
  "BLOG_COMMENT_REPLY",
  "EMAIL_SELLER_BROADCAST",
  "EMAIL_NEW_FOLLOWER",
];

const DEFAULT_OFF_EMAIL = ["EMAIL_SELLER_BROADCAST", "EMAIL_NEW_FOLLOWER"];

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
    if (DEFAULT_OFF.includes(type)) return prefs[type] === true;
    return prefs[type] !== false;
  }

  function getEmailPrefInitial(key: string): boolean {
    if (key in prefs) return prefs[key] as boolean;
    return !DEFAULT_OFF_EMAIL.includes(key);
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

  function EmailRow({ type, label, description }: { type: string; label: string; description: string }) {
    return (
      <div className="flex items-center justify-between py-3 border-b border-neutral-100 last:border-0">
        <div>
          <p className="text-sm font-medium text-neutral-800">{label}</p>
          <p className="text-xs text-neutral-400 mt-0.5">{description}</p>
        </div>
        <NotificationToggle type={type} enabled={getEmailPrefInitial(type)} />
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

      {/* ── In-App Notifications ──────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold mb-1">In-App Notifications</h2>
        <p className="text-sm text-neutral-500 mb-4">These appear in your notification bell.</p>

        {/* Group 1 — From Makers You Follow */}
        <section className="card-section p-5 mb-4">
          <h3 className="text-base font-semibold mb-3">From Makers You Follow</h3>
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
            description="Broadcasts and announcements from makers you follow (off by default)"
          />
        </section>

        {/* Group 2 — Orders & Cases */}
        <section className="card-section p-5 mb-4">
          <h3 className="text-base font-semibold mb-3">Orders &amp; Cases</h3>
          <Row
            type="NEW_ORDER"
            label="New orders"
            description="Order confirmations when someone purchases from you"
          />
          <Row
            type="ORDER_SHIPPED"
            label="Shipping updates"
            description="When your order has shipped"
          />
          <Row
            type="ORDER_DELIVERED"
            label="Delivery notices"
            description="When your order has been delivered"
          />
          {hasSeller && (
            <Row
              type="CASE_OPENED"
              label="Cases opened"
              description="When a buyer opens a case on one of your orders"
            />
          )}
          <Row
            type="CASE_MESSAGE"
            label="Case messages"
            description="New messages in an open case"
          />
          <Row
            type="CASE_RESOLVED"
            label="Case resolutions"
            description="When a case you are involved in is resolved"
          />
        </section>

        {/* Group 3 — Your Shop (sellers only) */}
        {hasSeller && (
          <section className="card-section p-5 mb-4">
            <h3 className="text-base font-semibold mb-3">Your Shop</h3>
            <Row
              type="NEW_MESSAGE"
              label="New messages"
              description="When someone sends you a message"
            />
            <Row
              type="NEW_REVIEW"
              label="New reviews"
              description="When a buyer leaves a review on one of your listings"
            />
            <Row
              type="NEW_FOLLOWER"
              label="New followers"
              description="When someone starts following your shop"
            />
            <Row
              type="CUSTOM_ORDER_REQUEST"
              label="Custom order requests"
              description="When a buyer requests a custom piece from you"
            />
            <Row
              type="CUSTOM_ORDER_LINK"
              label="Custom order ready"
              description="When a maker sends you a custom listing to purchase"
            />
            <Row
              type="COMMISSION_INTEREST"
              label="Commission interest"
              description="When a maker expresses interest in your commission request"
            />
            <Row
              type="NEW_FAVORITE"
              label="Someone saves your listing"
              description="When a buyer hearts one of your pieces (off by default)"
            />
            <div className="flex items-center justify-between py-3 border-b border-neutral-100">
              <div>
                <p className="text-sm font-medium text-neutral-800">Listing approved</p>
                <p className="text-xs text-neutral-400 mt-0.5">When a listing passes admin review — always sent</p>
              </div>
              <span className="text-xs text-neutral-400 italic">Always on</span>
            </div>
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-neutral-800">Listing rejected</p>
                <p className="text-xs text-neutral-400 mt-0.5">When a listing does not pass admin review — always sent</p>
              </div>
              <span className="text-xs text-neutral-400 italic">Always on</span>
            </div>
          </section>
        )}

        {/* Group 4 — Blog (sellers only) */}
        {hasSeller && (
          <section className="card-section p-5 mb-4">
            <h3 className="text-base font-semibold mb-3">Blog</h3>
            <Row
              type="NEW_BLOG_COMMENT"
              label="New comments on your posts"
              description="When someone comments on a blog post you wrote (off by default)"
            />
            <Row
              type="BLOG_COMMENT_REPLY"
              label="Replies to your comments"
              description="When someone replies to a comment you left (off by default)"
            />
          </section>
        )}
      </div>

      {/* ── Email Notifications ───────────────────────────────── */}
      <div className="border-t border-neutral-100 pt-6">
        <h2 className="text-lg font-semibold mb-1">Email Notifications</h2>
        <p className="text-sm text-neutral-500 mb-1">These are sent to your email address.</p>
        <p className="text-xs text-neutral-400 mb-4">
          Order confirmations, shipping updates, refund notifications, and case resolutions are always sent and cannot be disabled.
        </p>

        {/* Messages & Orders */}
        <section className="card-section p-5 mb-4">
          <h3 className="text-base font-semibold mb-3">Messages &amp; Orders</h3>
          <EmailRow
            type="EMAIL_NEW_MESSAGE"
            label="New messages"
            description="Email when someone sends you a message (5-minute active-conversation throttle)"
          />
          {hasSeller && (
            <EmailRow
              type="EMAIL_NEW_ORDER"
              label="New orders"
              description="Email when a buyer purchases from your shop"
            />
          )}
          {hasSeller && (
            <EmailRow
              type="EMAIL_CUSTOM_ORDER"
              label="Custom order requests &amp; links"
              description="Email for custom order requests (sellers) and custom pieces ready to purchase (buyers)"
            />
          )}
        </section>

        {/* Cases & Reviews */}
        <section className="card-section p-5 mb-4">
          <h3 className="text-base font-semibold mb-3">Cases &amp; Reviews</h3>
          {hasSeller && (
            <EmailRow
              type="EMAIL_CASE_OPENED"
              label="Cases opened against you"
              description="Email when a buyer opens a case on one of your orders"
            />
          )}
          <EmailRow
            type="EMAIL_CASE_MESSAGE"
            label="Case messages"
            description="Email when someone sends a message in an open case"
          />
          <EmailRow
            type="EMAIL_CASE_RESOLVED"
            label="Case resolutions"
            description="Email when a case you are involved in is resolved"
          />
          {hasSeller && (
            <EmailRow
              type="EMAIL_NEW_REVIEW"
              label="New reviews"
              description="Email when a buyer leaves a review on one of your listings"
            />
          )}
        </section>

        {/* From Makers You Follow */}
        <section className="card-section p-5 mb-4">
          <h3 className="text-base font-semibold mb-3">From Makers You Follow</h3>
          <EmailRow
            type="EMAIL_FOLLOWED_MAKER_NEW_LISTING"
            label="New listings from followed makers"
            description="Email when a maker you follow posts a new piece"
          />
          <EmailRow
            type="EMAIL_SELLER_BROADCAST"
            label="Shop updates from followed makers"
            description="Email broadcasts and announcements (off by default)"
          />
        </section>

        {/* Your Shop — sellers only */}
        {hasSeller && (
          <section className="card-section p-5">
            <h3 className="text-base font-semibold mb-3">Your Shop</h3>
            <EmailRow
              type="EMAIL_NEW_FOLLOWER"
              label="New followers"
              description="Email when someone starts following your shop (off by default)"
            />
          </section>
        )}
      </div>

      <p className="text-xs text-neutral-400">
        Changes take effect immediately. Security and account notices cannot be disabled.
      </p>
    </main>
  );
}
