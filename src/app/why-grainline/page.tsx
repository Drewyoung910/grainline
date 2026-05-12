import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Shield, Hammer, Eye, MessageCircle, MapPin, CheckCircle } from "@/components/icons";

export const metadata: Metadata = {
  title: "Why Grainline | Real handmade woodworking, not factory imports",
  description:
    "Grainline is a US marketplace exclusively for handmade woodworking. Every seller is Stripe-verified, every listing is AI-moderated, every piece is made by a real person. No mass-produced imports, no resellers, no anonymous shops.",
  alternates: { canonical: "https://thegrainline.com/why-grainline" },
};

export default async function WhyGrainlinePage() {
  const [listingCount, sellerCount, foundingCount] = await Promise.all([
    prisma.listing.count({ where: { status: "ACTIVE", isPrivate: false } }),
    prisma.sellerProfile.count({
      where: {
        chargesEnabled: true,
        vacationMode: false,
        user: { banned: false, deletedAt: null },
        listings: { some: { status: "ACTIVE", isPrivate: false } },
      },
    }),
    prisma.sellerProfile.count({ where: { isFoundingMaker: true } }),
  ]);

  return (
    <div className="bg-gradient-to-b from-amber-50/40 via-white to-white min-h-[100svh]">
      {/* Hero */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-12 text-center">
        <p className="text-xs uppercase tracking-wider text-amber-700 mb-4 font-semibold">
          Why Grainline
        </p>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-display font-bold text-neutral-900 mb-6 leading-tight">
          Real wood. Real workshops.<br />Real people.
        </h1>
        <p className="text-lg sm:text-xl text-stone-600 leading-relaxed max-w-2xl mx-auto">
          Grainline is the US marketplace built exclusively for handmade woodworking. No factory imports, no
          resellers, no anonymous shops. Just craftspeople and the pieces they build by hand.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/browse"
            className="inline-flex items-center rounded-full bg-[#2C1F1A] px-7 py-3 text-sm font-semibold text-white hover:bg-[#3A2A24] transition-colors"
          >
            Browse the Workshop
          </Link>
          <Link
            href="/map"
            className="inline-flex items-center rounded-full border-2 border-[#2C1F1A] px-7 py-3 text-sm font-semibold text-[#2C1F1A] hover:bg-[#2C1F1A] hover:text-white transition-colors"
          >
            Find Makers Near You
          </Link>
        </div>
      </section>

      {/* The handmade-trust problem */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-neutral-900 mb-4">
            The word &ldquo;handmade&rdquo; stopped meaning much online.
          </h2>
          <p className="text-stone-600 max-w-2xl mx-auto">
            On most marketplaces today, the same search for a handmade cutting board returns factory products,
            relisted Amazon imports, and AI-generated photos of pieces that don&apos;t exist. We built Grainline so
            that doesn&apos;t happen here.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
          <div className="card-section p-6">
            <p className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-3">
              What handmade has become
            </p>
            <ul className="space-y-3 text-sm text-neutral-700">
              <li>Mass-produced imports with a sticker on the back</li>
              <li>Drop-shipped products from overseas wholesalers</li>
              <li>AI-generated listing photos of pieces that don&apos;t exist</li>
              <li>Anonymous shops with no verified identity</li>
              <li>Counterfeits using copyrighted designs</li>
            </ul>
          </div>
          <div className="card-section p-6 bg-amber-50/40">
            <p className="text-xs uppercase tracking-wider text-amber-700 font-semibold mb-3">
              What handmade means on Grainline
            </p>
            <ul className="space-y-3 text-sm text-neutral-800">
              <li className="flex items-start gap-2">
                <CheckCircle size={16} className="text-amber-700 mt-0.5 flex-none" />
                <span>Every piece made by hand in a US workshop</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle size={16} className="text-amber-700 mt-0.5 flex-none" />
                <span>Every seller verified through Stripe</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle size={16} className="text-amber-700 mt-0.5 flex-none" />
                <span>Every listing reviewed before it goes live</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle size={16} className="text-amber-700 mt-0.5 flex-none" />
                <span>No drop-shipping, no resellers, no imports</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle size={16} className="text-amber-700 mt-0.5 flex-none" />
                <span>Real people, real workshops, real names</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* How we verify */}
      <section className="bg-[#EFEAE0]/40 py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-display font-bold text-neutral-900 mb-4">
              How we keep it real.
            </h2>
            <p className="text-stone-600 max-w-2xl mx-auto">
              Four mechanisms working together so you can buy with confidence.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-5">
            <div className="card-section p-6 bg-white">
              <Shield size={28} className="text-amber-700 mb-3" />
              <h3 className="font-display font-semibold text-lg text-neutral-900 mb-2">
                Identity verification
              </h3>
              <p className="text-sm text-neutral-600 leading-relaxed">
                Every maker is verified through Stripe&apos;s identity checks before they can sell. No anonymous
                shops, no shell accounts. We know who&apos;s behind every listing.
              </p>
            </div>
            <div className="card-section p-6 bg-white">
              <Eye size={28} className="text-amber-700 mb-3" />
              <h3 className="font-display font-semibold text-lg text-neutral-900 mb-2">
                AI moderation on every listing
              </h3>
              <p className="text-sm text-neutral-600 leading-relaxed">
                New listings are scanned for counterfeits, mass-produced items, drop-shipping, AI-generated photos,
                and prohibited categories. Anything flagged goes to staff review before buyers see it.
              </p>
            </div>
            <div className="card-section p-6 bg-white">
              <Hammer size={28} className="text-amber-700 mb-3" />
              <h3 className="font-display font-semibold text-lg text-neutral-900 mb-2">
                Guild badges, earned not paid
              </h3>
              <p className="text-sm text-neutral-600 leading-relaxed">
                Established makers earn Guild Member status by hitting performance criteria. Top performers earn
                Guild Master, which is re-evaluated monthly. You can&apos;t buy these badges. They have to be
                earned and maintained.
              </p>
            </div>
            <div className="card-section p-6 bg-white">
              <MessageCircle size={28} className="text-amber-700 mb-3" />
              <h3 className="font-display font-semibold text-lg text-neutral-900 mb-2">
                A real dispute system
              </h3>
              <p className="text-sm text-neutral-600 leading-relaxed">
                If something arrives damaged, late, or wrong, open a case. The maker has 48 hours to respond. If
                you can&apos;t reach an agreement, Grainline staff make the final call and issue the refund.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* The badge ladder */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-neutral-900 mb-4">
            Three badges that mean something.
          </h2>
          <p className="text-stone-600 max-w-2xl mx-auto">
            We don&apos;t hand these out. Each one means a maker has done specific, verifiable work.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-5">
          <div className="card-section p-6 text-center bg-white">
            <div className="flex justify-center mb-4">
              <svg width={48} height={48} viewBox="0 0 100 100" aria-hidden="true">
                <defs>
                  <radialGradient id="fm-disc" cx="50%" cy="35%" r="65%">
                    <stop offset="0%" stopColor="#FFE9A8" />
                    <stop offset="55%" stopColor="#D29A3A" />
                    <stop offset="100%" stopColor="#8B5E1F" />
                  </radialGradient>
                </defs>
                <circle cx="50" cy="50" r="46" fill="url(#fm-disc)" stroke="#6B4514" strokeWidth="2" />
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
            <h3 className="font-display font-semibold text-lg text-neutral-900 mb-1">Founding Maker</h3>
            <p className="text-xs uppercase tracking-wider text-amber-700 font-semibold mb-3">First 250 sellers</p>
            <p className="text-sm text-neutral-600 leading-relaxed">
              Permanent recognition for the first 250 makers who posted an active listing on Grainline. There&apos;s
              only one set of 250. Once granted, the number is theirs forever.
            </p>
            <p className="mt-3 text-xs text-stone-500">
              {foundingCount} of 250 granted
            </p>
          </div>
          <div className="card-section p-6 text-center bg-white">
            <div className="flex justify-center mb-4">
              <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-50 text-amber-700 font-display font-bold">
                GM
              </span>
            </div>
            <h3 className="font-display font-semibold text-lg text-neutral-900 mb-1">Guild Member</h3>
            <p className="text-xs uppercase tracking-wider text-amber-700 font-semibold mb-3">Established makers</p>
            <p className="text-sm text-neutral-600 leading-relaxed">
              5+ active listings, $250+ in completed sales, an account in good standing, and a manual review by
              Grainline staff. A solid, working-shop signal.
            </p>
          </div>
          <div className="card-section p-6 text-center bg-white">
            <div className="flex justify-center mb-4">
              <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-indigo-50 text-indigo-700 font-display font-bold">
                GM+
              </span>
            </div>
            <h3 className="font-display font-semibold text-lg text-neutral-900 mb-1">Guild Master</h3>
            <p className="text-xs uppercase tracking-wider text-indigo-700 font-semibold mb-3">Top tier, monthly checked</p>
            <p className="text-sm text-neutral-600 leading-relaxed">
              4.5+ star rating, 25+ reviews, 95%+ on-time shipping, 90%+ response rate, no open disputes, 180+
              day account age, $1,000+ in sales. Re-evaluated every month.
            </p>
          </div>
        </div>
      </section>

      {/* American-made */}
      <section className="bg-[#EFEAE0]/40 py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <p className="text-xs uppercase tracking-wider text-amber-700 mb-3 font-semibold">
            Made in the USA. Built in Texas.
          </p>
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-neutral-900 mb-4">
            Every maker is American.
          </h2>
          <p className="text-stone-600 max-w-2xl mx-auto mb-8">
            Grainline is a Texas-registered marketplace, and every seller on it ships from a US address. When you
            buy here, your money goes to an American craftsperson, not an overseas reseller.
          </p>
          <div className="grid grid-cols-3 gap-4 max-w-xl mx-auto mb-8">
            <div className="bg-white rounded-xl p-5">
              <div className="text-2xl sm:text-3xl font-bold text-neutral-900">
                {listingCount.toLocaleString("en-US")}
              </div>
              <div className="text-xs text-stone-500 mt-1">pieces listed</div>
            </div>
            <div className="bg-white rounded-xl p-5">
              <div className="text-2xl sm:text-3xl font-bold text-neutral-900">
                {sellerCount.toLocaleString("en-US")}
              </div>
              <div className="text-xs text-stone-500 mt-1">active makers</div>
            </div>
            <div className="bg-white rounded-xl p-5">
              <div className="text-2xl sm:text-3xl font-bold text-neutral-900">50</div>
              <div className="text-xs text-stone-500 mt-1">states served</div>
            </div>
          </div>
          <Link
            href="/map"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#2C1F1A] hover:underline"
          >
            <MapPin size={16} />
            See the makers map
          </Link>
        </div>
      </section>

      {/* Buyer protection */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-neutral-900 mb-4">
            You&apos;re protected on every purchase.
          </h2>
          <p className="text-stone-600 max-w-2xl mx-auto">
            Stripe handles the payment. Grainline handles the disputes.
          </p>
        </div>

        <div className="card-section p-6 sm:p-8 bg-white">
          <ol className="space-y-5">
            <li className="flex gap-4">
              <span className="flex-none w-8 h-8 rounded-full bg-amber-100 text-amber-800 font-semibold flex items-center justify-center text-sm">
                1
              </span>
              <div>
                <p className="font-semibold text-neutral-900 mb-1">Something goes wrong with your order.</p>
                <p className="text-sm text-neutral-600">
                  Damaged in transit, didn&apos;t arrive, isn&apos;t as described, or just plain wrong.
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-none w-8 h-8 rounded-full bg-amber-100 text-amber-800 font-semibold flex items-center justify-center text-sm">
                2
              </span>
              <div>
                <p className="font-semibold text-neutral-900 mb-1">Open a case from your order page.</p>
                <p className="text-sm text-neutral-600">
                  The maker is notified instantly and has 48 hours to respond.
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-none w-8 h-8 rounded-full bg-amber-100 text-amber-800 font-semibold flex items-center justify-center text-sm">
                3
              </span>
              <div>
                <p className="font-semibold text-neutral-900 mb-1">Most cases resolve directly.</p>
                <p className="text-sm text-neutral-600">
                  Full refund, partial refund, replacement, or another resolution you both agree on.
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex-none w-8 h-8 rounded-full bg-amber-100 text-amber-800 font-semibold flex items-center justify-center text-sm">
                4
              </span>
              <div>
                <p className="font-semibold text-neutral-900 mb-1">If not, Grainline staff step in.</p>
                <p className="text-sm text-neutral-600">
                  Either side can escalate after 48 hours. We review the case, make a binding decision, and issue
                  the refund through Stripe. Your FCBA chargeback rights remain intact throughout.
                </p>
              </div>
            </li>
          </ol>
        </div>

        <p className="text-center text-sm text-stone-500 mt-8">
          See <Link href="/help/shipping-and-returns" className="underline hover:text-stone-900">Shipping &amp; returns</Link>{" "}
          and <Link href="/help/trust-and-safety" className="underline hover:text-stone-900">Trust &amp; safety</Link>{" "}
          for the full details.
        </p>
      </section>

      {/* Final CTA */}
      <section className="bg-[#2C1F1A] text-white py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-display font-bold mb-4">
            Buy from a real maker.
          </h2>
          <p className="text-white/80 mb-8">
            Browse handmade woodworking from American craftspeople. Find a piece you love, or commission something
            new.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/browse"
              className="inline-flex items-center rounded-full bg-white px-7 py-3 text-sm font-semibold text-[#2C1F1A] hover:bg-stone-100 transition-colors"
            >
              Browse the Workshop
            </Link>
            <Link
              href="/commission"
              className="inline-flex items-center rounded-full border-2 border-white px-7 py-3 text-sm font-semibold text-white hover:bg-white hover:text-[#2C1F1A] transition-colors"
            >
              Commission a piece
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
