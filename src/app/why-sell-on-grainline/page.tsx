import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import {
  Truck,
  BarChart,
  Edit,
  Sparkles,
  CheckCircle,
  XCircle,
  Hammer,
  Shield,
} from "@/components/icons";

export const metadata: Metadata = {
  title: "Why Sell on Grainline | 5% fee, no mandatory ads, no shipping skim",
  description:
    "A US marketplace for handmade woodworking. 5% platform fee on item price only, never on shipping. No listing fees, no mandatory advertising, no surprise rate changes. Founding Maker status for the first 250 sellers.",
  alternates: { canonical: "https://thegrainline.com/why-sell-on-grainline" },
};

export default async function WhySellOnGrainlinePage() {
  const { userId } = await auth();
  const ctaHref = userId ? "/dashboard" : "/sign-up?redirect_url=%2Fdashboard";
  const foundingCount = await prisma.sellerProfile.count({ where: { isFoundingMaker: true } });
  const foundingRemaining = Math.max(0, 250 - foundingCount);

  return (
    <div className="bg-gradient-to-b from-amber-50/40 via-white to-white min-h-[100svh]">
      {/* Hero */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-12 text-center">
        <p className="text-xs uppercase tracking-wider text-amber-700 mb-4 font-semibold">
          For makers
        </p>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-display font-bold text-neutral-900 mb-6 leading-tight">
          Sell handmade.<br />Keep more of it.
        </h1>
        <p className="text-lg sm:text-xl text-stone-600 leading-relaxed max-w-2xl mx-auto">
          A flat 5% platform fee on item price only. No listing fees. No mandatory ads. No skim on your shipping.
          Just a marketplace built for makers who actually make things.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href={ctaHref}
            className="inline-flex items-center rounded-full bg-[#2C1F1A] px-7 py-3 text-sm font-semibold text-white hover:bg-[#3A2A24] transition-colors"
          >
            Start your shop
          </Link>
          <Link
            href="/seller-handbook"
            className="inline-flex items-center rounded-full border-2 border-[#2C1F1A] px-7 py-3 text-sm font-semibold text-[#2C1F1A] hover:bg-[#2C1F1A] hover:text-white transition-colors"
          >
            Read the seller handbook
          </Link>
        </div>
      </section>

      {/* Fee comparison */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-neutral-900 mb-4">
            What you actually pay.
          </h2>
          <p className="text-stone-600 max-w-2xl mx-auto">
            All four major marketplaces, side by side. Real take rates, not headline rates. Your actual mileage
            depends on your category and shop size, but the gap is consistent.
          </p>
        </div>

        <div className="card-section overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Comparison of Grainline fees with other marketplace fee structures</caption>
              <thead>
                <tr className="bg-amber-50 border-b border-stone-200">
                  <th scope="col" className="text-left p-4 font-semibold text-neutral-900 min-w-[160px]">Platform</th>
                  <th scope="col" className="text-left p-4 font-semibold text-neutral-900">Platform fee</th>
                  <th scope="col" className="text-left p-4 font-semibold text-neutral-900">Listing fees</th>
                  <th scope="col" className="text-left p-4 font-semibold text-neutral-900">Mandatory ads</th>
                  <th scope="col" className="text-left p-4 font-semibold text-neutral-900">Charges shipping?</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                <tr className="bg-amber-50/60">
                  <td className="p-4">
                    <div className="font-display font-semibold text-neutral-900">Grainline</div>
                    <div className="text-xs text-stone-500 mt-0.5">Handmade woodworking</div>
                  </td>
                  <td className="p-4 font-semibold text-neutral-900">5%</td>
                  <td className="p-4 text-neutral-700">None</td>
                  <td className="p-4 text-neutral-700">None</td>
                  <td className="p-4 text-neutral-700">No, item price only</td>
                </tr>
                <tr>
                  <td className="p-4">
                    <div className="font-display font-semibold text-neutral-900">Etsy</div>
                    <div className="text-xs text-stone-500 mt-0.5">General handmade + vintage</div>
                  </td>
                  <td className="p-4">
                    <div className="text-neutral-700">6.5% + Offsite Ads 12% (mandatory at $10K+)</div>
                    <div className="text-xs text-stone-500 mt-0.5">~20% to 30% effective</div>
                  </td>
                  <td className="p-4 text-neutral-700">$0.20 / 4 months</td>
                  <td className="p-4 text-neutral-700">Yes, above $10K/yr</td>
                  <td className="p-4 text-neutral-700">Yes, all fees apply to shipping</td>
                </tr>
                <tr>
                  <td className="p-4">
                    <div className="font-display font-semibold text-neutral-900">Faire</div>
                    <div className="text-xs text-stone-500 mt-0.5">Wholesale</div>
                  </td>
                  <td className="p-4 text-neutral-700">15% (25% on direct shops)</td>
                  <td className="p-4 text-neutral-700">None</td>
                  <td className="p-4 text-neutral-700">None</td>
                  <td className="p-4 text-neutral-700">Free shipping required</td>
                </tr>
                <tr>
                  <td className="p-4">
                    <div className="font-display font-semibold text-neutral-900">Amazon Handmade</div>
                    <div className="text-xs text-stone-500 mt-0.5">General handmade</div>
                  </td>
                  <td className="p-4 text-neutral-700">15%</td>
                  <td className="p-4 text-neutral-700">None</td>
                  <td className="p-4 text-neutral-700">Optional but expected</td>
                  <td className="p-4 text-neutral-700">Yes</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-stone-500 px-4 py-3 border-t border-stone-100">
            Stripe processing (~2.9% + $0.30) applies to card payments. Grainline currently absorbs it
            under our payout model; the numbers above compare platform fees.
          </p>
        </div>
      </section>

      {/* The Etsy take-rate trap */}
      <section className="bg-[#EFEAE0]/40 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-neutral-900 mb-6">
            The Etsy take-rate trap.
          </h2>
          <p className="text-stone-700 leading-relaxed mb-4">
            If you run an Etsy shop today, you already feel this. The headline rate is 6.5%. The reality, once
            you cross $10,000 in annual sales, is closer to 22% to 28% of every order.
          </p>
          <p className="text-stone-700 leading-relaxed mb-4">
            Here&apos;s how it stacks up. Etsy charges 6.5% transaction fee, applied to your item price AND your
            shipping. Then payment processing on top of that, also applied to shipping. Then Offsite Ads, which
            became mandatory for shops over $10K/yr. That&apos;s another 12% (15% for smaller shops) on the full
            order total, again including shipping. Then Etsy Ads, technically optional, but if you don&apos;t pay
            you don&apos;t show up in search.
          </p>
          <p className="text-stone-700 leading-relaxed mb-4">
            The math gets ugly fast. On a $50 piece with $15 shipping, an established Etsy seller running ads
            takes home roughly $48 to $52 after every fee. The fees that are charged on your shipping are pure
            seller cost. Buyers paid for shipping; you funded the platform&apos;s cut on it.
          </p>
          <p className="text-stone-700 leading-relaxed">
            On Grainline, that same $50 piece with $15 shipping nets you $62.50 before tax or refund
            adjustments. We charge nothing on shipping. We charge nothing on tax. Stripe processing is absorbed
            by Grainline under our payout model. The math stays simple.
          </p>
        </div>
      </section>

      {/* Founding Maker */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-neutral-900 mb-4">
            Founding Maker. 250 spots. Then it&apos;s closed forever.
          </h2>
          <p className="text-stone-600 max-w-2xl mx-auto">
            The first 250 makers who post a public active listing on Grainline get a permanent Founding Maker
            badge. The badge is numbered, never reassigned, and stays with the shop for as long as it exists.
          </p>
        </div>

        <div className="card-section p-8 bg-white">
          <div className="grid sm:grid-cols-2 gap-8 items-center">
            <div className="flex justify-center">
              <svg width={160} height={160} viewBox="0 0 100 100" aria-hidden="true">
                <defs>
                  <radialGradient id="fm-large" cx="50%" cy="35%" r="65%">
                    <stop offset="0%" stopColor="#FFE9A8" />
                    <stop offset="55%" stopColor="#D29A3A" />
                    <stop offset="100%" stopColor="#8B5E1F" />
                  </radialGradient>
                </defs>
                <circle cx="50" cy="50" r="46" fill="url(#fm-large)" stroke="#6B4514" strokeWidth="2" />
                <circle cx="50" cy="50" r="36" fill="none" stroke="#6B4514" strokeWidth="1.5" opacity="0.7" />
                <polygon
                  points="50,22 58,42 80,42 62,55 69,76 50,63 31,76 38,55 20,42 42,42"
                  fill="#FFF6DC"
                  stroke="#6B4514"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div>
              <div className="mb-4">
                <div className="text-4xl font-display font-bold text-neutral-900">
                  {foundingRemaining} <span className="text-lg text-stone-500 font-normal">of 250 spots left</span>
                </div>
                <div className="text-sm text-stone-500 mt-1">
                  {foundingCount} {foundingCount === 1 ? "maker has" : "makers have"} claimed Founding Maker so far.
                </div>
              </div>
              <ul className="space-y-2 text-sm text-neutral-700">
                <li className="flex items-start gap-2">
                  <CheckCircle size={16} className="text-amber-700 mt-0.5 flex-none" />
                  <span>Numbered #1 through #250 in order of first active listing.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle size={16} className="text-amber-700 mt-0.5 flex-none" />
                  <span>Permanent. Never revoked. Never reassigned.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle size={16} className="text-amber-700 mt-0.5 flex-none" />
                  <span>Displayed on your shop, your listings, and your maker profile.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle size={16} className="text-amber-700 mt-0.5 flex-none" />
                  <span>Independent of Guild Member or Guild Master. You can have all three.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* What we don't do */}
      <section className="bg-[#EFEAE0]/40 py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-display font-bold text-neutral-900 mb-4">
              What we don&apos;t do.
            </h2>
            <p className="text-stone-600 max-w-2xl mx-auto">
              The four things that drive sellers away from other marketplaces. We won&apos;t do any of them.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-5">
            <div className="card-section p-6 bg-white">
              <XCircle size={28} className="text-red-600 mb-3" />
              <h3 className="font-display font-semibold text-lg text-neutral-900 mb-2">No mandatory ads</h3>
              <p className="text-sm text-neutral-600 leading-relaxed">
                We don&apos;t run an Offsite Ads program or anything like it. You will never be forced to pay an
                additional percentage of your sales for ads you didn&apos;t opt into.
              </p>
            </div>
            <div className="card-section p-6 bg-white">
              <XCircle size={28} className="text-red-600 mb-3" />
              <h3 className="font-display font-semibold text-lg text-neutral-900 mb-2">No listing fees</h3>
              <p className="text-sm text-neutral-600 leading-relaxed">
                List 5 pieces or 500. There&apos;s no per-listing charge, no renewal fees, no expiration. You only
                pay when something sells.
              </p>
            </div>
            <div className="card-section p-6 bg-white">
              <XCircle size={28} className="text-red-600 mb-3" />
              <h3 className="font-display font-semibold text-lg text-neutral-900 mb-2">No shipping skim</h3>
              <p className="text-sm text-neutral-600 leading-relaxed">
                Our 5% applies to your item price only. Shipping passes through untouched. Buyers pay the live
                carrier rate, you pay the carrier, we don&apos;t take a cut.
              </p>
            </div>
            <div className="card-section p-6 bg-white">
              <XCircle size={28} className="text-red-600 mb-3" />
              <h3 className="font-display font-semibold text-lg text-neutral-900 mb-2">No surprise rate changes</h3>
              <p className="text-sm text-neutral-600 leading-relaxed">
                Fee changes are grandfathered. New fees apply only to orders placed after the change takes
                effect. We&apos;ll never quietly raise rates on your existing orders or inventory.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* What you get */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-neutral-900 mb-4">
            What you get.
          </h2>
          <p className="text-stone-600 max-w-2xl mx-auto">
            Built into every shop, no upgrade tier required.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <div className="card-section p-6 bg-white">
            <Truck size={24} className="text-amber-700 mb-3" />
            <h3 className="font-display font-semibold text-base text-neutral-900 mb-2">Live carrier rates</h3>
            <p className="text-sm text-neutral-600 leading-relaxed">
              USPS, UPS, FedEx, DHL pulled live at checkout. Buy your shipping label directly from your sales
              dashboard, deducted from your payout automatically.
            </p>
          </div>
          <div className="card-section p-6 bg-white">
            <Sparkles size={24} className="text-amber-700 mb-3" />
            <h3 className="font-display font-semibold text-base text-neutral-900 mb-2">Direct Stripe payouts</h3>
            <p className="text-sm text-neutral-600 leading-relaxed">
              Connected directly to your bank account. Payouts arrive on Stripe&apos;s standard schedule, typically
              2 business days after the order is paid.
            </p>
          </div>
          <div className="card-section p-6 bg-white">
            <Shield size={24} className="text-amber-700 mb-3" />
            <h3 className="font-display font-semibold text-base text-neutral-900 mb-2">AI listing review</h3>
            <p className="text-sm text-neutral-600 leading-relaxed">
              Every new listing is scanned for trust and quality. Approved listings go live in seconds. Anything
              flagged goes to staff review so your work isn&apos;t buried next to imports.
            </p>
          </div>
          <div className="card-section p-6 bg-white">
            <BarChart size={24} className="text-amber-700 mb-3" />
            <h3 className="font-display font-semibold text-base text-neutral-900 mb-2">Real analytics</h3>
            <p className="text-sm text-neutral-600 leading-relaxed">
              Views, clicks, favorites, conversion rate, profile visits, top listings, repeat-buyer rate. The data
              you need to actually understand your shop.
            </p>
          </div>
          <div className="card-section p-6 bg-white">
            <Hammer size={24} className="text-amber-700 mb-3" />
            <h3 className="font-display font-semibold text-base text-neutral-900 mb-2">Custom orders + commissions</h3>
            <p className="text-sm text-neutral-600 leading-relaxed">
              Buyers request custom pieces. You quote, build a private listing reserved for them, they check out
              normally. The commission room also matches buyer briefs with available makers.
            </p>
          </div>
          <div className="card-section p-6 bg-white">
            <Edit size={24} className="text-amber-700 mb-3" />
            <h3 className="font-display font-semibold text-base text-neutral-900 mb-2">A blog that features makers</h3>
            <p className="text-sm text-neutral-600 leading-relaxed">
              Maker spotlights, build guides, and behind-the-build stories on the Grainline blog. You can also
              publish your own posts and reach buyers directly.
            </p>
          </div>
        </div>
      </section>

      {/* Risk reversal */}
      <section className="bg-[#EFEAE0]/40 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-neutral-900 mb-6">
            Try it. The downside is zero.
          </h2>
          <p className="text-stone-700 leading-relaxed mb-3">
            Listing is free. The 5% fee only applies when a sale actually closes. If nothing sells, you pay
            nothing.
          </p>
          <p className="text-stone-700 leading-relaxed mb-3">
            Run Grainline alongside your existing shops. Most successful makers use multiple channels. We&apos;re
            offering a second one, not asking you to abandon what works.
          </p>
          <p className="text-stone-700 leading-relaxed">
            If after 6 months you don&apos;t see value, close the shop. No fee, no penalty, no fight.
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-[#2C1F1A] text-white py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-display font-bold mb-4">
            Open your shop in 10 minutes.
          </h2>
          <p className="text-white/80 mb-8">
            Stripe Connect is the only verification step. After that you can list, customize your profile, and
            start taking orders.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href={ctaHref}
              className="inline-flex items-center rounded-full bg-white px-7 py-3 text-sm font-semibold text-[#2C1F1A] hover:bg-stone-100 transition-colors"
            >
              Start your shop
            </Link>
            <Link
              href="/seller-handbook"
              className="inline-flex items-center rounded-full border-2 border-white px-7 py-3 text-sm font-semibold text-white hover:bg-white hover:text-[#2C1F1A] transition-colors"
            >
              Read the handbook first
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
