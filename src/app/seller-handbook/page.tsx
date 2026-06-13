// src/app/seller-handbook/page.tsx
//
// Public seller handbook. Google-indexable, doubles as the canonical
// reference for makers evaluating Grainline vs Etsy / their own website
// before signing up. Sections are anchored (id="fees", id="guild", etc.)
// so footer + dashboard links can deep-link straight to the section.
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Seller Handbook | Grainline",
  description:
    "Everything you need to sell handmade woodworking on Grainline. Fees, photos, pricing, shipping, custom orders, Guild verification, and how disputes are handled.",
  alternates: { canonical: "https://thegrainline.com/seller-handbook" },
  openGraph: {
    title: "Seller Handbook | Grainline",
    description:
      "How to sell handmade woodworking on Grainline. Fees, photos, shipping, Guild verification, and trust & safety.",
    url: "https://thegrainline.com/seller-handbook",
    type: "article",
  },
};

export default function SellerHandbookPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
      <header className="mb-12">
        <p className="text-sm font-medium text-amber-700 mb-2">For Makers</p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-neutral-900 mb-4">
          Seller Handbook
        </h1>
        <p className="text-lg text-neutral-700 leading-relaxed">
          Everything you need to set up shop and sell handmade woodworking on Grainline.
          Read it once; come back when something changes.
        </p>
      </header>

      {/* Table of contents */}
      <nav aria-label="Handbook sections" className="mb-12 rounded-lg border border-stone-200/60 bg-[#EFEAE0] p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-3">On this page</p>
        <ul className="space-y-1 text-sm">
          <li><a href="#getting-started" className="text-neutral-800 hover:underline">1. Getting started</a></li>
          <li><a href="#listings" className="text-neutral-800 hover:underline">2. Creating a great listing</a></li>
          <li><a href="#photos" className="text-neutral-800 hover:underline">3. Photos that sell</a></li>
          <li><a href="#pricing" className="text-neutral-800 hover:underline">4. Pricing your work</a></li>
          <li><a href="#fees" className="text-neutral-800 hover:underline">5. Fees &amp; payouts</a></li>
          <li><a href="#shipping" className="text-neutral-800 hover:underline">6. Shipping &amp; packaging</a></li>
          <li><a href="#custom-orders" className="text-neutral-800 hover:underline">7. Custom orders</a></li>
          <li><a href="#guild" className="text-neutral-800 hover:underline">8. Guild verification</a></li>
          <li><a href="#disputes" className="text-neutral-800 hover:underline">9. Trust, disputes &amp; refunds</a></li>
          <li><a href="#taxes" className="text-neutral-800 hover:underline">10. Taxes</a></li>
          <li><a href="#growth" className="text-neutral-800 hover:underline">11. Growing your shop</a></li>
        </ul>
      </nav>

      <div className="prose prose-neutral max-w-none prose-headings:font-display prose-headings:font-semibold prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4 prose-h3:text-lg prose-h3:mt-8 prose-h3:mb-3 prose-p:leading-relaxed prose-a:text-amber-700 prose-a:no-underline hover:prose-a:underline">

        <section id="getting-started">
          <h2>1. Getting started</h2>
          <p>
            Grainline is a Texas-based marketplace for makers selling handmade woodworking: furniture, kitchenware,
            home goods, custom commissions, and everything between. Before you can publish your first listing
            you need three things:
          </p>
          <ol>
            <li>A Grainline account. Sign up at <Link href="/sign-up">/sign-up</Link>.</li>
            <li>A connected Stripe account. We use Stripe Connect for all payouts. Connect it from{" "}
              <Link href="/dashboard/seller">Shop Settings</Link>. Verification typically clears in 2 to 3 business days.</li>
            <li>A shop profile. Add a display name, tagline, a banner photo (3:1, 15MB max), and an avatar.
              Sellers with complete profiles get up to 3× more views than those without.</li>
          </ol>
          <p>
            Once Stripe is connected and your profile is filled in, you can publish your first listing.
          </p>
        </section>

        <section id="listings">
          <h2>2. Creating a great listing</h2>
          <p>
            Every listing on Grainline goes through AI moderation before going live (it&apos;s usually instant; flagged
            listings go to staff review within 24 hours). The AI is checking for: clear product photos, an honest
            description, materials and dimensions, and that the piece is actually handmade woodworking.
          </p>

          <h3>Title</h3>
          <p>
            Lead with what the piece <em>is</em>, not adjectives. <strong>&quot;Walnut live-edge dining table, 84″ × 36″&quot;</strong>{" "}
            outranks &quot;Beautiful handcrafted dining furniture.&quot; Use up to 100 characters; include the wood species,
            style, and approximate dimensions.
          </p>

          <h3>Description</h3>
          <p>
            Cover the four things buyers actually want to know:
          </p>
          <ul>
            <li><strong>Materials</strong>: wood species, finish, hardware.</li>
            <li><strong>Dimensions</strong>: length × width × height in inches.</li>
            <li><strong>Process</strong>: 1–2 sentences on how it&apos;s made (hand-cut joinery, mineral oil finish, etc).</li>
            <li><strong>Care</strong>: how to maintain it (re-oil cutting boards every 3 months, dust with damp cloth, etc).</li>
          </ul>
          <p>
            Aim for 200–500 words. Listings under 100 characters of description are flagged as low-quality and won&apos;t
            rank well in search.
          </p>

          <h3>Tags</h3>
          <p>
            Up to 10 tags. Mix specific (<code>walnut</code>, <code>live-edge</code>, <code>dining-table</code>) and
            broad (<code>furniture</code>, <code>handmade</code>). Tags drive internal search relevance and the
            &quot;You might also like&quot; engine that pulls buyers between listings.
          </p>

          <h3>Meta description</h3>
          <p>
            Optional but worth it. This is the snippet Google shows under your listing in search results. 160
            characters max. If you leave it blank, we use the first 160 characters of your description. Writing a
            custom one usually clicks better.
          </p>
        </section>

        <section id="photos">
          <h2>3. Photos that sell</h2>
          <p>
            Photos do more sales work than every other field combined. We allow up to 10 per listing, 12MB each.
            The first photo is your cover and shows up on browse pages cropped to 4:5 portrait.
          </p>

          <h3>What to shoot</h3>
          <ul>
            <li><strong>Hero shot</strong>: the whole piece, well-lit, neutral background.</li>
            <li><strong>Detail shots</strong>: joinery, grain, hardware close-ups.</li>
            <li><strong>In-context shot</strong>: the piece in a real space (living room, kitchen, workshop) so buyers can
              visualize scale.</li>
            <li><strong>Process shots</strong>: a glimpse of you working. Milling, sanding, finishing. Adds enormous trust.</li>
          </ul>

          <h3>Technical tips</h3>
          <ul>
            <li>Shoot in daylight if you can. A north-facing window is ideal. Overhead workshop fluorescents make wood look orange.</li>
            <li>Aim for 2400px+ on the long edge. Higher resolution helps when buyers zoom on the listing page.</li>
            <li>Use descriptive filenames (<code>walnut-cutting-board-mineral-oil.jpg</code> beats <code>IMG_4521.jpg</code>).
              Google indexes them.</li>
            <li>Don&apos;t use stock photos, illustrations, or logos as listing photos. AI review rejects them.</li>
          </ul>

          <h3>Alt text</h3>
          <p>
            If you leave alt text blank when uploading, our AI auto-generates SEO-friendly descriptions for each
            photo. You can always override on the edit page if the AI gets it wrong. Alt text helps Google Image
            Search find your work.
          </p>
        </section>

        <section id="pricing">
          <h2>4. Pricing your work</h2>
          <p>
            New makers underprice. Don&apos;t be a new maker. The two pricing models that work on Grainline:
          </p>

          <h3>Cost-plus (most common)</h3>
          <p>
            Materials + tools amortized + shop overhead + (hours × your target hourly rate) + 30–50% margin.
            Hourly rate should reflect skilled labor, not minimum wage. For experienced makers we see $60–$120/hr is
            normal. The 30–50% margin covers your time selling, packaging, customer service, and the inevitable
            redo when a piece doesn&apos;t come out right.
          </p>

          <h3>Value-based (for one-of-a-kind)</h3>
          <p>
            What is a similar custom piece going for from a designer or boutique? Match it. If your live-edge walnut
            console would retail for $2,800 at West Elm or a designer studio, charge $2,400 on Grainline. You&apos;re not
            competing with Wayfair. You&apos;re competing with handmade alternatives.
          </p>

          <h3>Variants</h3>
          <p>
            Use variants to surface upsells: wood species, finish options, hardware, size. Each option can carry its
            own price adjustment. Buyers see the live total update as they pick. Done well, variants double your
            average order value.
          </p>
        </section>

        <section id="fees">
          <h2>5. Fees &amp; payouts</h2>
          <p>Grainline keeps fees simple. Three things to know:</p>
          <ul>
            <li><strong>5% platform fee</strong> on each sale&apos;s subtotal (item price + variant adjustments). Shipping
              and taxes aren&apos;t included in the fee base.</li>
            <li><strong>Stripe processing</strong>: ~2.9% + $0.30 per transaction. Same as every other major marketplace,
              and currently absorbed by Grainline under our payout model rather than separately deducted from your payout.</li>
            <li><strong>$0 listing fees</strong>. List as many pieces as you want. You only pay when you sell.</li>
          </ul>
          <p>
            <strong>How this compares to Etsy.</strong> A typical Etsy sale stacks up like this:
          </p>
          <ul>
            <li>$0.20 listing fee (paid every 4 months whether it sells or not)</li>
            <li>6.5% transaction fee, <em>applied to item price <strong>and</strong> shipping</em></li>
            <li>Payment processing: ~3% + $0.25, also charged on shipping</li>
            <li>
              <strong>Offsite Ads</strong>: a 12% fee (15% for shops under $10K/yr) on any sale Etsy
              attributes to one of their ad partners (Google, Facebook, Bing, Pinterest, Instagram, etc.). It is{" "}
              <em>mandatory for shops over $10K/yr</em>, meaning you cannot opt out. Etsy charges this on the full order
              total <strong>including shipping</strong>.
            </li>
            <li>
              <strong>Etsy Ads</strong> (optional, on top of Offsite Ads): a daily budget Etsy spends to promote your
              listings. Sellers commonly report 10%+ of revenue going to ads just to stay visible in search.
            </li>
          </ul>
          <p>
            For an established Etsy shop running Offsite Ads + Etsy Ads, the effective take-rate is commonly{" "}
            <strong>20% to 30%+</strong> of gross sales. A meaningful chunk of that is charged on the shipping you
            collect from the buyer, not just your item price. Grainline&apos;s 5% applies only to the item subtotal.
            No mandatory ads, no shipping markup, no recurring listing fees.
          </p>
          <p>
            Faire takes 15% on first orders from a new buyer (25% on direct-from-store). Amazon Handmade is 15% plus
            their own ad ecosystem. Grainline&apos;s 5% is a fraction of any of these, by design.
          </p>

          <h3>Payouts</h3>
          <p>
            Stripe deposits your earnings (sale price minus the 5% Grainline fee) into your
            connected bank account on a rolling schedule, typically 2 business days after the order is paid. You can
            view your balance and payout history in your Stripe dashboard, linked from{" "}
            <Link href="/dashboard/seller">Shop Settings</Link>.
          </p>

          <h3>Refunds</h3>
          <p>
            If you issue a refund (or a buyer wins a case), Stripe automatically reverses the corresponding portion of
            the payout. Refunds don&apos;t cost you Grainline&apos;s 5%. We waive our fee on refunded amounts. Stripe&apos;s
            processing fees are not separately passed to you through the normal Grainline refund tools.
          </p>
        </section>

        <section id="shipping">
          <h2>6. Shipping &amp; packaging</h2>

          <h3>Calculated rates (recommended)</h3>
          <p>
            Enter packaged dimensions and weight on each listing (inches and pounds, we convert internally for the
            carriers). Grainline pulls live rates from USPS, UPS, FedEx, and DHL at checkout. Buyers see actual rates
            for their address, and you can purchase the label directly from your Sales dashboard. The cost is
            deducted from your payout automatically.
          </p>
          <p>
            You can also pre-set <strong>default package dimensions</strong> in Shop Settings, used as a fallback for
            listings that don&apos;t specify their own size.
          </p>

          <h3>Flat-rate shipping</h3>
          <p>
            If you ship a lot of similar-size items, flat-rate is simpler. Set one rate per shop in Shop Settings.
            Optional &quot;free shipping over $X&quot; threshold encourages larger orders.
          </p>

          <h3>Local pickup</h3>
          <p>
            For heavy or oversized pieces, enable local pickup. Buyers within your area see a $0 pickup option at
            checkout. You coordinate the handoff via Messages once payment clears.
          </p>

          <h3>Packaging</h3>
          <p>
            Handmade pieces get returned for &quot;arrived damaged&quot; more than any other reason. A few rules:
          </p>
          <ul>
            <li>Double-wall corrugated boxes for anything heavier than 5lb.</li>
            <li>Foam corners or air pillows on every edge. Don&apos;t cheap out on void fill.</li>
            <li>Wrap each piece in glassine or kraft paper before bubble wrap. It protects finished surfaces from sticking.</li>
            <li>For furniture: blanket-wrap + cardboard corners + freight (not USPS). Use Shippo&apos;s LTL options.</li>
            <li>Include a hand-written thank-you card. Drives repeat customers and reviews.</li>
          </ul>

          <h3>Returns</h3>
          <p>
            Set your return policy on your shop profile. Most makers do <strong>14-day returns on stock items, no
            returns on custom orders</strong>. Buyers see the policy on every listing page. Custom-order returns are
            negotiated through Messages and our Cases system.
          </p>
        </section>

        <section id="custom-orders">
          <h2>7. Custom orders</h2>
          <p>
            Custom commissions are usually your highest-margin work. Grainline has two ways to capture them:
          </p>

          <h3>Commission Room</h3>
          <p>
            Buyers post requests at <Link href="/commission">/commission</Link> with budget, timeline, and reference
            photos. As a maker, browse the room, express interest, and message the buyer directly. You can post a
            custom listing reserved just for them. They buy it through normal checkout once you agree on the spec.
          </p>

          <h3>Custom Order Requests on your listings</h3>
          <p>
            Toggle &quot;Accepts custom orders&quot; in your shop profile. A &quot;Request a custom piece&quot; button appears on
            your shop page and every listing. Buyers fill out a short form (what they want, dimensions, timeline,
            budget) that lands in your Messages. You reply, agree on terms, and create a private listing for them.
          </p>

          <h3>Gift wrapping</h3>
          <p>
            Enable gift wrapping in Shop Settings to offer it as an upsell at checkout. Set your price (suggestion:
            $5–$15 for a thoughtful wrap including a card). Buyers can add a gift note that prints on the packing slip.
          </p>

          <h3>Processing time</h3>
          <p>
            Be honest. For made-to-order pieces, set min and max days in Shop Settings. Buyers see &quot;Ships in 14–21
            days&quot; on every listing. Estimated delivery dates on order pages are calculated from this + shipping
            transit time. Missing your stated time is the #1 reason cases get opened.
          </p>
        </section>

        <section id="guild">
          <h2>8. Guild verification</h2>
          <p>
            The Guild is a two-tier badge program signaling that a maker has been verified and consistently delivers
            quality work. Buyers see the badge on listings, your shop page, and in search results. Guild Members get
            priority placement in browse relevance ranking and in Featured Maker rotations.
          </p>

          <h3>Guild Member (entry tier)</h3>
          <p>Eligibility, all required:</p>
          <ul>
            <li>5+ active listings.</li>
            <li>$250+ in completed sales (lifetime).</li>
            <li>30+ day account age.</li>
            <li>No open cases over 60 days old.</li>
            <li>Complete shop profile (avatar, banner, bio, return + shipping policies).</li>
          </ul>
          <p>
            Apply from <Link href="/dashboard/verification">/dashboard/verification</Link>. Staff reviews each
            application; approvals typically take 2–5 business days.
          </p>

          <h3>Guild Master (top tier)</h3>
          <p>
            Available only after you&apos;ve been a Guild Member for at least 30 days. Stricter ongoing metrics:
            average rating ≥ 4.5, 25+ reviews, 95%+ on-time shipping, 90%+ message response rate, $1,000+ lifetime
            sales, no active cases. Re-evaluated monthly. If metrics slip, you get a 30-day warning before
            demotion.
          </p>
          <p>
            Guild Master listings get featured rotation on the homepage, an additional ranking boost in browse,
            and access to the Maker of the Week spotlight.
          </p>
        </section>

        <section id="disputes">
          <h2>9. Trust, disputes &amp; refunds</h2>
          <p>
            Grainline handles disputes in-house through the <strong>Cases</strong> system rather than throwing it back
            to credit card chargebacks (which cost you more and damage your seller account). If a buyer has a problem,
            they can open a case from their order page within the 30-day case window after
            delivery, pickup, or the estimated delivery date.
          </p>

          <h3>The case lifecycle</h3>
          <ol>
            <li><strong>Buyer opens a case.</strong> You get 48 hours to respond via the case message thread.</li>
            <li><strong>You and the buyer talk it out.</strong> Most cases resolve at this stage with a partial refund, replacement, or similar agreement.</li>
            <li><strong>Either party can escalate</strong> to Grainline staff after 48 hours of discussion if you can&apos;t agree.</li>
            <li><strong>Staff resolution.</strong> We review the order, messages, photos, and decide: full refund, partial refund, or dismiss.</li>
          </ol>

          <h3>What you control</h3>
          <p>
            From your sales dashboard you can issue a full or partial refund at any time before staff resolution. Doing
            this proactively (within 48 hours of a case) tends to keep buyer reviews positive.
          </p>

          <h3>Chargebacks</h3>
          <p>
            If a buyer bypasses our case system and disputes the charge directly with their bank, we&apos;ll work with you
            to respond. Chargebacks cost $15 in fees regardless of outcome. They&apos;re bad for everyone.
          </p>
        </section>

        <section id="taxes">
          <h2>10. Taxes</h2>
          <p>
            Grainline is registered as a <strong>marketplace facilitator</strong> in Texas, so we collect and remit
            state sales tax on all Texas-bound orders. You don&apos;t need to do anything for those orders.
          </p>
          <p>
            For income tax: Stripe issues you a 1099-K if you cross the IRS reporting threshold ($600/year through
            2026, may change). Save your sales records. You&apos;re responsible for federal income tax on your earnings.
            Consult a tax professional for anything complicated; we don&apos;t give tax advice.
          </p>
        </section>

        <section id="growth">
          <h2>11. Growing your shop</h2>

          <h3>The basics that compound</h3>
          <ul>
            <li><strong>Reply fast.</strong> Sub-2-hour message response rates drive higher conversion. Set up email
              notifications in your profile.</li>
            <li><strong>Ask for reviews.</strong> A polite follow-up message 1 week after delivery doubles review
              rates. Reviews are the single biggest signal for our quality-score ranking.</li>
            <li><strong>Write blog posts.</strong> Your maker page links to your blog. Each post is a Google-indexed
              page that drives organic discovery. Even short build journals help.</li>
            <li><strong>Maintain your shop.</strong> Refresh listings every 2–4 weeks. New listings get a temporary
              ranking boost in browse.</li>
          </ul>

          <h3>Cross-promotion</h3>
          <ul>
            <li><strong>Instagram + Pinterest</strong>: post your hero shots with the listing link. Your followers
              become Grainline traffic.</li>
            <li><strong>Shop updates</strong>: send a broadcast to your followers when you list a new piece. From{" "}
              <Link href="/dashboard/seller">Shop Settings → Shop Updates</Link>.</li>
            <li><strong>Local craft fairs</strong>: bring 1-page handouts with your shop QR code.</li>
          </ul>

          <h3>Categories that move</h3>
          <p>
            Based on early Grainline sales: cutting boards and small kitchen items convert fastest (entry-price,
            giftable); custom furniture has the highest order value (low volume, high margin); commissioned pieces via
            the Commission Room have the highest customer satisfaction (because the buyer specified exactly what they
            wanted).
          </p>
        </section>

      </div>

      {/* CTA at bottom of handbook */}
      <section className="mt-16 rounded-lg border border-stone-200/60 bg-[#EFEAE0] p-8 text-center">
        <h2 className="font-display text-2xl font-semibold text-neutral-900 mb-3">Ready to start selling?</h2>
        <p className="text-neutral-700 mb-5 max-w-md mx-auto">
          5% fees, no listing fees, real maker tools. Set up your shop in under 10 minutes.
        </p>
        <Link
          href="/become-a-maker"
          className="inline-flex items-center rounded-md bg-neutral-900 text-white px-6 py-3 text-sm font-medium hover:bg-neutral-800 transition-colors"
        >
          Become a maker →
        </Link>
      </section>

      <p className="mt-10 text-xs text-neutral-500">
        Questions this handbook didn&apos;t answer? Email{" "}
        <a href="mailto:support@thegrainline.com" className="underline">support@thegrainline.com</a> or open a
        ticket at <Link href="/support" className="underline">/support</Link>.
      </p>
    </main>
  );
}
