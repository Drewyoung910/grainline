import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shipping & Returns",
  description:
    "How shipping, delivery timelines, refunds, and returns work for buyers on Grainline.",
  alternates: { canonical: "https://thegrainline.com/help/shipping-and-returns" },
};

export default function ShippingAndReturnsHelpPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
      <header className="mb-10">
        <p className="text-xs uppercase tracking-wider text-stone-500 mb-2">Help</p>
        <h1 className="text-3xl sm:text-4xl font-display font-semibold text-neutral-900 mb-3">
          Shipping &amp; returns
        </h1>
        <p className="text-stone-600 text-lg leading-relaxed">
          Everything you need to know about delivery times, tracking, and getting your money back if
          something goes wrong.
        </p>
      </header>

      <div className="prose prose-neutral max-w-none prose-headings:font-display prose-headings:font-semibold prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-3 prose-p:leading-relaxed prose-a:text-amber-700 prose-a:no-underline hover:prose-a:underline">
        <h2>When will my order ship?</h2>
        <p>
          Two things determine when a piece ships: <strong>processing time</strong> (how long the maker
          takes to prepare or build it) and <strong>shipping time</strong> (carrier transit). The
          listing shows the processing time, and checkout shows the shipping options and their
          estimated transit time.
        </p>
        <ul>
          <li>
            <strong>In stock</strong> listings ship within the timeframe the maker sets, usually 1 to 3
            business days.
          </li>
          <li>
            <strong>Made to order</strong> listings show a processing window (for example, &ldquo;ships in
            2–4 weeks&rdquo;). The maker builds your piece during that window, then ships it.
          </li>
        </ul>
        <p>
          Once your maker ships, you&apos;ll get an email with tracking. You can also see status updates
          on your order page under{" "}
          <Link href="/account/orders">My Account → Orders</Link>.
        </p>

        <h2>Local pickup</h2>
        <p>
          Some makers offer local pickup as a free shipping option. If pickup is available, you&apos;ll
          see it at checkout. After the maker marks your piece ready, you&apos;ll get an email with
          pickup instructions and contact details. Coordinate directly through Messages.
        </p>

        <h2>Shipping costs</h2>
        <p>
          Makers either set a flat shipping price or use live carrier rates for your address, which are
          calculated at checkout. You see the price before you pay. If the maker accepts pickup, you can
          select pickup at no charge.
        </p>

        <h2>If something arrives damaged, late, or wrong</h2>
        <p>
          Open a case from your order page. Go to{" "}
          <Link href="/account/orders">My Account → Orders</Link>, open the order, and look for the
          &ldquo;Open a case&rdquo; button. It appears once enough time has passed for the piece to have
          been delivered.
        </p>
        <p>
          The maker has 48 hours to respond. Many cases are settled directly between you and the maker,
          and the maker can issue a full refund. If you can&apos;t reach agreement, you can escalate the
          case to Grainline staff, who can decide on a full refund, a partial refund, or no refund.
        </p>

        <h2>Refunds</h2>
        <p>
          Refunds go back to the original payment method, typically within 5–10 business days depending
          on your bank. You&apos;ll receive an email confirmation as soon as the refund is issued.
        </p>
        <p>
          Tax is refunded automatically in proportion to the amount refunded.
        </p>

        <h2>Returns</h2>
        <p>
          Each maker sets their own return policy. You&apos;ll find it on every shop&apos;s public
          profile under &ldquo;Shop Policies.&rdquo; Many handmade and made-to-order pieces are
          non-returnable by default, so check before you buy if returns matter to you.
        </p>
        <p>
          If the piece arrived damaged or wasn&apos;t as described, you don&apos;t need to rely on the
          maker&apos;s return policy. Open a case instead.
        </p>

        <h2>Lost or stolen packages</h2>
        <p>
          If tracking shows the package was delivered but you didn&apos;t receive it, open a case. We
          take buyer protection seriously and review these claims case by case.
        </p>

        <h2>Still need help?</h2>
        <p>
          Email <a href="mailto:support@thegrainline.com">support@thegrainline.com</a> or use our{" "}
          <Link href="/support">support form</Link>. We typically respond within one business day.
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
