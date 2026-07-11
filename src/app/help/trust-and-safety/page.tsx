import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Trust & Safety | Grainline",
  description:
    "How Grainline protects buyers. Verified makers, secure payments, dispute resolution, and reporting tools.",
  alternates: { canonical: "https://thegrainline.com/help/trust-and-safety" },
};

export default function TrustAndSafetyHelpPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
      <header className="mb-10">
        <p className="text-xs uppercase tracking-wider text-stone-500 mb-2">Help</p>
        <h1 className="text-3xl sm:text-4xl font-display font-semibold text-neutral-900 mb-3">
          Trust &amp; safety
        </h1>
        <p className="text-stone-600 text-lg leading-relaxed">
          How we keep Grainline a safe place to buy real, handmade work from real makers.
        </p>
      </header>

      <div className="prose prose-neutral max-w-none prose-headings:font-display prose-headings:font-semibold prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-3 prose-p:leading-relaxed prose-a:text-amber-700 prose-a:no-underline hover:prose-a:underline">
        <h2>Real handmade work, real makers</h2>
        <p>
          Every Grainline maker connects a verified Stripe account before they can sell. We don&apos;t
          allow drop-shipping, mass-produced imports relabeled as handmade, or counterfeit goods. Every
          new listing is reviewed by our AI moderation system, and human staff review anything flagged.
        </p>
        <p>
          Look for the <strong>Guild badges</strong> on maker profiles and listings:
        </p>
        <ul>
          <li>
            <strong>Guild Member</strong>: established makers with a complete profile, 5+ active
            listings, $250+ in completed sales, an account in good standing, and a Grainline staff
            review.
          </li>
          <li>
            <strong>Guild Master</strong>: top-tier makers with a sustained 4.5+ star rating, 25+
            reviews, 95%+ on-time shipping, 90%+ response rate, 180+ day account age, $1,000+ in sales,
            and zero open disputes. Re-checked monthly.
          </li>
        </ul>

        <h2>Secure payments</h2>
        <p>
          All payments are processed by Stripe, the same payment provider that powers Shopify, Lyft,
          and Target. Grainline never sees or stores your card details. Your information goes
          straight from your browser to Stripe&apos;s servers.
        </p>
        <p>
          We support Apple Pay, Google Pay, and all major credit cards.
        </p>

        <h2>Buyer protection</h2>
        <p>
          If a piece doesn&apos;t arrive, arrives damaged, or isn&apos;t as described, you can open a
          case from your order page within 30 days of the delivery date. The maker has 48 hours to
          respond. If you can&apos;t reach an agreement, you can escalate to Grainline staff for a
          binding decision.
        </p>
        <p>
          For full details on how disputes work, see our{" "}
          <Link href="/help/shipping-and-returns">shipping &amp; returns page</Link>.
        </p>

        <h2>Reporting a problem</h2>
        <p>
          See something that doesn&apos;t belong, like a counterfeit listing, harassment in messages, a
          suspicious shop, a fake review, or content that violates our terms? Use the report button on
          any listing, profile, message thread, review, or blog comment. Reports go to our admin team
          for review.
        </p>
        <p>
          For urgent safety issues, email{" "}
          <a href="mailto:abuse@thegrainline.com">abuse@thegrainline.com</a> directly.
        </p>

        <h2>Blocking another user</h2>
        <p>
          Don&apos;t want to interact with a particular buyer or maker? Use the &ldquo;Block&rdquo;
          option on their profile or message thread. Blocked users can&apos;t message you, follow you,
          favorite your listings, or see your content anywhere on Grainline. You can manage your
          blocked list under{" "}
          <Link href="/account/blocked">My Account → Blocked users</Link>.
        </p>

        <h2>Your data and privacy</h2>
        <p>
          We never sell your data. Read our full{" "}
          <Link href="/privacy">Privacy Policy</Link> for what we collect, how we use it, and how to
          delete your account. You can request an export of your data or delete your account at any
          time from <Link href="/account">My Account</Link>.
        </p>

        <h2>Counterfeit, IP, or DMCA concerns</h2>
        <p>
          If you believe a listing infringes a trademark or copyright you own, send a takedown request
          to <a href="mailto:legal@thegrainline.com">legal@thegrainline.com</a> with the listing URL
          and proof of your rights. We registered a DMCA designated agent with the US Copyright Office
          and respond to valid notices promptly.
        </p>

        <h2>Still need help?</h2>
        <p>
          Email <a href="mailto:support@thegrainline.com">support@thegrainline.com</a> or use our{" "}
          <Link href="/support">support form</Link>.
        </p>
      </div>

      <div className="mt-12 pt-8 border-t border-stone-200">
        <Link href="/" className="text-sm text-amber-700 hover:underline">
          ← Back to Grainline
        </Link>
      </div>
    </main>
  );
}
