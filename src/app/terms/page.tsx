// src/app/terms/page.tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Grainline Terms of Service — the rules and conditions governing your use of the Grainline handmade woodworking marketplace.",
  robots: { index: true, follow: true },
};

const TOC = [
  { id: "acceptance",         label: "1. Acceptance of Terms" },
  { id: "service",            label: "2. Description of Service" },
  { id: "accounts",           label: "3. User Accounts" },
  { id: "maker-terms",        label: "4. Maker (Seller) Terms" },
  { id: "buyer-terms",        label: "5. Buyer Terms" },
  { id: "payments",           label: "6. Payments and Fees" },
  { id: "shipping",           label: "7. Shipping and Delivery" },
  { id: "returns",            label: "8. Returns, Refunds, and Cancellations" },
  { id: "disputes",           label: "9. Dispute Resolution (Cases)" },
  { id: "prohibited",         label: "10. Prohibited Activities" },
  { id: "ip",                 label: "11. Intellectual Property" },
  { id: "privacy",            label: "12. Privacy" },
  { id: "disclaimers",        label: "13. Disclaimers and Limitation of Liability" },
  { id: "indemnification",    label: "14. Indemnification" },
  { id: "governing-law",      label: "15. Governing Law and Dispute Resolution" },
  { id: "termination",        label: "16. Termination" },
  { id: "changes",            label: "17. Changes to Terms" },
  { id: "contact",            label: "18. Contact Information" },
  { id: "guild",              label: "19. Guild Verification Program" },
  { id: "force-majeure",      label: "20. Force Majeure" },
  { id: "accessibility",      label: "21. Accessibility" },
  { id: "commission-room",    label: "22. Commission Room" },
  { id: "following",          label: "23. Following System and Seller Broadcasts" },
  { id: "blog-content",       label: "24. Blog and Community Content" },
  { id: "ai-review",          label: "25. Automated Content Review" },
  { id: "vacation-mode",      label: "26. Vacation Mode" },
  { id: "reviews-ratings",    label: "27. Reviews and Ratings" },
  { id: "messaging",          label: "28. Messaging" },
  { id: "notifications",      label: "29. Notifications and Communication Preferences" },
  { id: "algorithmic",        label: "30. Algorithmic Features and Recommendations" },
  { id: "geo-restrictions",   label: "31. Geographic Restrictions" },
  { id: "private-listings",   label: "32. Private and Reserved Listings" },
  { id: "general-provisions", label: "33. General Provisions" },
];

export default function TermsPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12 print:py-4">

      {/* Header */}
      <div className="mb-10">
        <p className="text-sm text-neutral-500 mb-2">Legal</p>
        <h1 className="text-4xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-neutral-500">Last Updated: March 30, 2026</p>

        <div className="mt-6 rounded border border-red-300 bg-red-50 px-5 py-4 text-sm text-red-900">
          <strong>DRAFT — Under Attorney Review.</strong> Last reviewed March 30, 2026. This document
          is a draft and has not been finalized by legal counsel. Do not rely on this document as
          final legal advice. Consult a qualified attorney for legal advice specific to your situation.
        </div>
      </div>

      {/* Table of Contents */}
      <nav className="mb-12 rounded border border-neutral-200 bg-stone-50 px-6 py-5 print:hidden">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 mb-3">Table of Contents</h2>
        <ol className="space-y-1.5">
          {TOC.map((item) => (
            <li key={item.id}>
              <a href={`#${item.id}`} className="text-sm text-neutral-700 hover:text-neutral-900 hover:underline">
                {item.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* Body */}
      <div className="space-y-12 text-neutral-800 leading-relaxed text-[15px]">

        {/* 1 */}
        <section id="acceptance">
          <h2 className="text-xl font-semibold mb-4">1. Acceptance of Terms</h2>
          <p>
            Welcome to Grainline. By accessing or using the Grainline website, mobile applications,
            or any related services (collectively, the &quot;Platform&quot;), you agree to be bound by
            these Terms of Service (&quot;Terms&quot;), our{" "}
            <Link href="/privacy" className="underline hover:text-neutral-600">Privacy Policy</Link>,
            and any additional guidelines or policies incorporated herein by reference.
          </p>
          <p className="mt-4">
            <strong>Age requirement.</strong> You must be at least 18 years of age to use the Platform
            independently. If you are between 13 and 17 years of age, you may only use the Platform
            with the verified consent and direct supervision of a parent or legal guardian who agrees
            to these Terms on your behalf. By using the Platform, you represent and warrant that you
            meet this requirement.
          </p>
          <p className="mt-4">
            <strong>Updates to Terms.</strong> Grainline reserves the right to modify these Terms at
            any time. We will provide notice of material changes by email and/or by posting a prominent
            notice on the Platform at least 30 days before the changes take effect. Your continued use
            of the Platform after the effective date of any revised Terms constitutes your acceptance
            of the updated Terms. If you do not agree to the revised Terms, you must discontinue use.
          </p>
          <p className="mt-4">
            <strong>Entire agreement.</strong> These Terms, together with the Privacy Policy and any
            other policies referenced herein, constitute the entire agreement between you and Grainline
            with respect to your use of the Platform.
          </p>
        </section>

        {/* 2 */}
        <section id="service">
          <h2 className="text-xl font-semibold mb-4">2. Description of Service</h2>
          <p>
            Grainline is an online marketplace platform that enables independent makers and craftspeople
            (&quot;Makers&quot;) to list, offer for sale, and sell handmade woodworking and craft items
            to buyers (&quot;Buyers&quot;). Grainline provides the technology and infrastructure for
            these transactions but is not a party to any transaction between Makers and Buyers.
          </p>
          <p className="mt-4">
            <strong>Grainline is a venue only.</strong> Grainline does not manufacture, inspect, store,
            ship, or guarantee any items listed on the Platform. All items are listed and sold by
            independent Makers. Grainline makes no representations or warranties regarding the quality,
            safety, legality, or accuracy of any listings or items.
          </p>
          <p className="mt-4">
            <strong>Marketplace facilitator.</strong> Notwithstanding the above, Grainline operates as
            a marketplace facilitator for sales tax purposes under applicable state and federal laws.
            See Section 6.4 for details on sales tax collection and remittance.
          </p>
          <p className="mt-4">
            <strong>Independent contractors.</strong> Makers are independent sellers and are not
            employees, agents, partners, or franchisees of Grainline. Grainline does not supervise,
            direct, or control Makers&apos; businesses, products, or fulfillment activities.
          </p>
          <p className="mt-4">
            <strong>Platform availability.</strong> Grainline strives to maintain Platform availability
            but does not guarantee uninterrupted or error-free service. We reserve the right to
            suspend, modify, or discontinue the Platform or any feature at any time.
          </p>
        </section>

        {/* 3 */}
        <section id="accounts">
          <h2 className="text-xl font-semibold mb-4">3. User Accounts</h2>
          <p>
            To access certain features of the Platform, you must register for an account. When
            registering, you agree to provide accurate, current, and complete information and to keep
            that information updated.
          </p>
          <ul className="list-disc pl-6 mt-4 space-y-2">
            <li>
              <strong>One account per person.</strong> You may only maintain one active account.
              Creating multiple accounts to circumvent suspensions, bans, or platform policies is
              prohibited.
            </li>
            <li>
              <strong>Account security.</strong> You are solely responsible for maintaining the
              confidentiality of your login credentials and for all activities that occur under your
              account. Notify Grainline immediately at{" "}
              <a href="mailto:legal@thegrainline.com" className="underline">legal@thegrainline.com</a>{" "}
              of any suspected unauthorized use.
            </li>
            <li>
              <strong>No account transfer.</strong> You may not sell, transfer, or assign your account
              or any account rights to any third party without Grainline&apos;s prior written consent.
            </li>
            <li>
              <strong>Suspension and termination.</strong> Grainline reserves the right to suspend or
              permanently terminate your account at any time for any violation of these Terms, for
              fraudulent or harmful conduct, or for any other reason at Grainline&apos;s sole
              discretion, with or without prior notice.
            </li>
            <li>
              <strong>Accurate information.</strong> Providing false, misleading, or fraudulent account
              information is grounds for immediate termination and may subject you to legal liability.
            </li>
          </ul>
        </section>

        {/* 4 */}
        <section id="maker-terms">
          <h2 className="text-xl font-semibold mb-4">4. Maker (Seller) Terms</h2>

          <h3 className="text-base font-semibold mt-6 mb-2">4.1 Eligibility to Sell</h3>
          <p>
            To sell on Grainline, you must be at least 18 years of age, legally authorized to sell
            goods in your jurisdiction, capable of entering into binding contracts, and able to connect
            a Stripe account for payouts. Grainline reserves the right to approve or deny any
            application to sell at its sole discretion.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.2 Permitted Listings</h3>
          <p>
            Grainline is a marketplace for handmade woodworking and craft items. Permitted listings
            include original handmade furniture, kitchen items, decorative items, home and office items,
            toys, art, outdoor items, gifts, jewelry, and other handcrafted pieces where wood or
            natural materials are a primary component. Items must have been made by you or by members
            of your shop.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.3 Prohibited Listings</h3>
          <p>The following items may not be listed on Grainline under any circumstances:</p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>Illegal items or items that facilitate illegal activity</li>
            <li>Counterfeit goods or items that infringe on any intellectual property rights</li>
            <li>Dangerous, hazardous, or unsafe items</li>
            <li>Items not made by you or your shop</li>
            <li>Mass-produced items misrepresented as handmade</li>
            <li>Dropshipped items without clear disclosure</li>
            <li>Items subject to recall or known safety issues</li>
            <li>Items prohibited under applicable law</li>
            <li>Alcohol, tobacco, cannabis, or controlled substances</li>
            <li>Live animals or animal products requiring permits</li>
            <li>Weapons or items that could be converted to weapons in violation of law</li>
          </ul>

          <h3 className="text-base font-semibold mt-6 mb-2">4.4 Listing Accuracy</h3>
          <p>
            You are solely responsible for the accuracy of your listings. Listings must accurately
            represent the item&apos;s description, materials, dimensions, condition, photos, processing
            time, and any applicable customization options. Misleading or deceptive listings are
            prohibited and may result in account suspension.
          </p>
          <p className="mt-3">
            Grainline does not independently verify or guarantee that any item is handmade, authentic,
            original, or accurately described. Buyers purchase items at their own risk. Any legal claim
            related to item authenticity or accuracy must be brought directly against the Maker.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.5 Fees</h3>
          <p>
            Grainline charges a platform fee of <strong>5% of the item subtotal</strong>{" "}
            (excluding shipping and taxes). This fee is deducted before your payout via Stripe Connect.
            Stripe&apos;s standard payment processing fees also apply. Grainline reserves the right to
            adjust its fee structure upon 30 days&apos; written notice.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.6 Fulfillment and Customer Service</h3>
          <p>
            As a Maker, you are solely responsible for fulfilling orders accurately and on time,
            communicating with buyers, handling returns and exchanges per your stated policy, and
            providing customer service. Grainline may facilitate dispute resolution but is not
            obligated to mediate every dispute.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.7 Taxes</h3>
          <p>
            Grainline collects and remits applicable sales tax as a marketplace facilitator (see
            Section 6.4). You are solely responsible for reporting and paying income tax and all
            other taxes not collected by Grainline on your sales earnings. Grainline will issue
            1099-K forms as required by IRS regulations. See Section 6.4 for full details.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.8 Custom Orders</h3>
          <p>
            Makers offering custom or made-to-order items must clearly communicate timelines,
            materials, and any non-refundable deposit terms before accepting payment. Custom order
            disputes are subject to Grainline&apos;s Case System. Cancellation of custom orders
            after work has commenced may result in partial or no refund at the Maker&apos;s
            discretion, subject to their stated policies disclosed to the buyer at time of order.
          </p>
          <p className="mt-3">
            Custom orders may be initiated through the Platform&apos;s messaging system, through the
            Commission Room (Section 22), or by using the &quot;Request Something Similar&quot; feature
            on listing pages. When a Maker agrees to create a custom piece, they may create a private
            listing (Section 32) visible only to the requesting Buyer. Custom orders processed through
            the Platform are subject to all standard terms including the Case System and platform fee.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.9 Inventory and Availability</h3>
          <p>
            Makers are responsible for maintaining accurate inventory counts on the Platform. Selling
            items that are unavailable or cannot be delivered as described constitutes a breach of
            these Terms and may result in forced cancellations, required refunds, negative impact on
            maker standing, and account suspension.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.10 Response Requirements</h3>
          <p>
            Makers are expected to respond to buyer inquiries and messages within 48 hours. Chronic
            non-responsiveness — including failure to respond to case messages within the required
            timeframes — may negatively affect maker standing, badge eligibility, and may result in
            account suspension.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.11 Shipping Requirements</h3>
          <p>
            Makers must ship orders within their stated processing time. Failure to ship within 3
            days of the stated processing deadline without proactively notifying the buyer may result
            in Grainline initiating a case on the buyer&apos;s behalf at its discretion. Makers must
            provide valid tracking information for all shipped orders.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.12 Independent Contractor Status</h3>
          <p>
            Makers are independent contractors, not employees, agents, or partners of Grainline.
            Makers are solely responsible for their own business operations, business licenses,
            insurance coverage, workers&apos; compensation, income taxes, and compliance with all
            applicable laws and regulations. Nothing in these Terms creates any employment,
            partnership, joint venture, or agency relationship between Makers and Grainline.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.13 Gift Wrapping</h3>
          <p>
            Makers offering gift wrapping services are solely responsible for the quality of gift
            wrapping provided. Grainline makes no representations about gift wrapping quality.
            Gift wrapping pricing is set by and paid to the Maker and is subject to the same platform
            fee as the underlying item.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.14 Stripe Connect</h3>
          <p>
            All payouts to Makers are processed through Stripe Connect. You must create and maintain
            a valid Stripe Connect account and comply with Stripe&apos;s terms of service and the
            Stripe Connected Account Agreement. Grainline is not responsible for delays, errors, or
            failures in Stripe&apos;s payout processing.
          </p>
          <p className="mt-3">
            The Stripe Connected Account Agreement and Stripe&apos;s Terms of Service are incorporated
            into these Terms by reference. In the event of a conflict between these Terms and
            Stripe&apos;s terms regarding payment processing, Stripe&apos;s terms shall govern with
            respect to payment processing matters. If your Stripe Connect account is suspended,
            deactivated, or disconnected — whether by Stripe, by you, or by Grainline — your listings
            will be automatically hidden from the Platform and you will be unable to receive new orders
            until a valid Stripe Connect account is restored.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.15 Content License</h3>
          <p>
            By posting listings on Grainline, you grant Grainline a non-exclusive, worldwide,
            royalty-free, sublicensable license to use, display, reproduce, and distribute your
            listing content (including photos, descriptions, and other materials) for the purpose of
            operating, promoting, and improving the Platform. This license survives removal of your
            listing but not deletion of your account.
          </p>
          <p className="mt-3">
            Notwithstanding the foregoing, listing data captured in order transaction records (listing
            snapshots) at the time of purchase is retained per the data retention schedule in the
            Privacy Policy, regardless of listing removal or account deletion, as required for tax
            compliance, dispute resolution, and legal obligations.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.16 Listing Removal</h3>
          <p>
            Grainline reserves the right to remove any listing or content at any time, for any reason,
            with or without notice, in its sole discretion. Reasons for removal may include, but are
            not limited to, violation of these Terms, receipt of a valid DMCA notice, suspected fraud,
            safety concerns, or any other reason Grainline deems appropriate. Removal of a listing
            does not entitle Makers to any refund of fees already paid.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.17 Off-Platform Transactions</h3>
          <p>
            All transactions for items discovered on Grainline must be completed through the Grainline
            Platform. Transactions conducted outside the Platform — including direct payment
            arrangements between Buyers and Makers that bypass Grainline — are strictly prohibited.
            Off-platform transactions:
          </p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>Are not protected by Grainline&apos;s Case System</li>
            <li>Are not eligible for dispute resolution or refund assistance from Grainline</li>
            <li>Violate Grainline&apos;s fee agreement and may constitute fraud against Grainline</li>
            <li>May result in immediate account suspension or termination for both parties</li>
          </ul>
          <p className="mt-3">
            Grainline is not responsible for any loss, fraud, or dispute arising from off-platform
            transactions. Soliciting off-platform transactions is a prohibited activity under
            Section 10.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.18 Product Liability</h3>
          <p>
            Makers are solely responsible for the safety, quality, and legality of their products.
            Makers are solely responsible for any injury, property damage, illness, or loss caused by
            their products. Makers who sell items that pose safety risks — including but not limited to
            furniture, tools, children&apos;s items, and food-contact items — should carry appropriate
            product liability insurance. Grainline expressly disclaims all liability for any harm
            caused by Maker products to the fullest extent permitted by law.
          </p>
          <p className="mt-3">
            By listing an item on Grainline, Makers represent and warrant that their products comply
            with all applicable product safety laws and regulations, including but not limited to the
            Consumer Product Safety Act, applicable ASTM standards, and any other federal, state, or
            local regulations applicable to the item type.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.19 Public Profile</h3>
          <p>
            By creating a seller profile on Grainline, you acknowledge that the following information
            is publicly visible to all users and may be indexed by search engines: your display name,
            tagline, biography, profile and banner photos, workshop photos, gallery images, city and
            state, years in business, shop policies, FAQ answers, ratings and reviews, follower count,
            active listings, and blog posts. Your precise workshop coordinates, if set, are used to
            display your approximate location on the Makers Map but exact coordinates are not displayed
            to users. Your email address is never displayed publicly.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.20 Makers Map</h3>
          <p>
            If you set a workshop location, your shop will appear as a pin on the publicly accessible
            Makers Map. Only your approximate location (city/region level) is displayed on the map.
            You may remove your map pin at any time by clearing your location in your dashboard settings.
          </p>
        </section>

        {/* 5 */}
        <section id="buyer-terms">
          <h2 className="text-xl font-semibold mb-4">5. Buyer Terms</h2>
          <p>
            By purchasing items on Grainline, you agree to the following terms and acknowledge your
            understanding of how the Platform works.
          </p>
          <ul className="list-disc pl-6 mt-4 space-y-2">
            <li>
              <strong>Payment obligation.</strong> You agree to pay all amounts stated at checkout,
              including the item price, shipping costs, and any applicable taxes.
            </li>
            <li>
              <strong>Accurate shipping information.</strong> You are responsible for providing
              accurate and complete shipping address information. Grainline and Makers are not
              responsible for delivery failures caused by inaccurate address information you provide.
            </li>
            <li>
              <strong>Independent makers.</strong> You understand and acknowledge that items are sold
              by independent Makers, not by Grainline. Grainline does not manufacture, inspect, or
              guarantee any item.
            </li>
            <li>
              <strong>Release of Grainline.</strong> To the maximum extent permitted by law, you
              release Grainline from any and all claims, demands, and damages arising out of or in
              connection with the quality, condition, safety, or legality of items purchased, or any
              dispute between you and a Maker.
            </li>
            <li>
              <strong>Maker policies.</strong> You are responsible for reviewing each Maker&apos;s
              return, shipping, and custom order policies before completing a purchase. Policies are
              displayed on each listing and Maker&apos;s shop profile.
            </li>
            <li>
              <strong>Chargebacks and payment disputes.</strong> You agree to contact Grainline
              through our Case System before initiating a chargeback with your bank or credit card
              issuer. Initiating a chargeback without first using the Case System may result in
              account suspension. Fraudulent chargebacks may result in permanent account termination
              and referral to appropriate authorities.
            </li>
          </ul>

          <h3 className="text-base font-semibold mt-6 mb-2">5.7 Cart and Inventory</h3>
          <p>
            Adding an item to your cart does not reserve that item. Items remain available for purchase
            by other Buyers until checkout is completed. If an item becomes unavailable between the
            time you add it to your cart and the time you attempt to complete checkout, the transaction
            will not be processed.
          </p>
        </section>

        {/* 6 */}
        <section id="payments">
          <h2 className="text-xl font-semibold mb-4">6. Payments and Fees</h2>

          <h3 className="text-base font-semibold mt-6 mb-2">6.1 Payment Processing</h3>
          <p>
            All payments on Grainline are processed by <strong>Stripe, Inc.</strong>, a third-party
            payment processor. Grainline never stores your full payment card information. By making a
            purchase, you agree to Stripe&apos;s{" "}
            <a href="https://stripe.com/legal" target="_blank" rel="noopener noreferrer" className="underline">
              Terms of Service
            </a>. All transactions are processed over encrypted connections (HTTPS/TLS) and Stripe
            maintains PCI DSS Level 1 compliance.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">6.2 Platform Fee</h3>
          <p>
            Grainline charges Makers a <strong>5% platform fee</strong> on each completed transaction
            (calculated on the item subtotal, excluding shipping and taxes). This fee is automatically
            deducted from the Maker&apos;s payout before transfer via Stripe Connect. Buyers are not
            charged this fee separately. Grainline reserves the right to change platform fees with
            <strong> 30 days written notice</strong> to affected Makers.
          </p>
          <p className="mt-3">
            When Grainline issues a refund through the Case System (Section 9), the platform fee is
            not refunded to the Maker. When a Maker issues a voluntary refund through the seller
            dashboard (Section 8.5), the platform fee is also not refunded.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">6.3 Maker Payouts</h3>
          <p>
            Makers receive payouts via Stripe Connect after deduction of the platform fee and
            Stripe&apos;s payment processing fees. Payout timing is governed by Stripe&apos;s standard
            payout schedule, typically <strong>2–7 business days</strong> after sale completion,
            depending on the Maker&apos;s Stripe account status and bank. Makers must maintain a valid,
            active Stripe Connect account to receive payouts. Grainline is not responsible for payout
            delays caused by Stripe, banking institutions, or incomplete Stripe account setup.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">6.4 Sales Tax — Marketplace Facilitator</h3>
          <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3 mt-2 mb-4 text-sm text-amber-900">
            <strong>Important Notice to Makers:</strong> This section constitutes Grainline&apos;s
            written certification to Makers as required by Texas and other marketplace facilitator laws.
          </div>
          <p>
            Grainline operates as a <strong>marketplace facilitator</strong> under applicable state
            laws, including the Texas Tax Code §151.0242 and equivalent laws in all states with a
            marketplace facilitator statute. As a marketplace facilitator, <strong>Grainline
            collects and remits applicable sales tax on all taxable transactions made through the
            Platform on behalf of Makers.</strong>
          </p>
          <p className="mt-4">
            By selling on Grainline, Makers authorize and acknowledge that:
          </p>
          <ul className="list-disc pl-6 mt-3 space-y-2">
            <li>Grainline will collect and remit sales tax on their behalf as required by law in each applicable state</li>
            <li>This agreement constitutes Grainline&apos;s written certification to Makers as required by Texas and other marketplace facilitator laws</li>
            <li>Makers who sell <em>exclusively</em> through Grainline may not need a separate sales tax permit in states where Grainline has certified it will collect and remit — however, <strong>Makers should consult a qualified tax professional for their specific situation</strong>, as requirements vary by state and individual circumstances</li>
            <li>Grainline assumes liability for sales tax collection and remittance on marketplace sales; Makers are relieved of this obligation for sales made through Grainline, provided Makers have not provided incorrect information to Grainline</li>
          </ul>
          <p className="mt-4">
            <strong>Income tax remains Maker&apos;s responsibility.</strong> Grainline&apos;s
            marketplace facilitator obligations cover only sales and use tax. Makers are solely
            responsible for all income taxes, self-employment taxes, and any other taxes on their
            earnings. Grainline will issue <strong>IRS Form 1099-K</strong> to Makers who receive
            $600 or more in annual payments through the Platform, as required by IRS regulations.
            Grainline does not provide tax advice; consult a qualified tax professional.
          </p>
          <p className="mt-4">
            <strong>Buyer sales tax.</strong> Applicable sales tax is calculated and displayed to
            Buyers at checkout before purchase is completed. Tax amounts are determined based on the
            shipping destination and applicable state and local rates.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">6.5 Stripe Tax</h3>
          <p>
            Grainline uses <strong>Stripe Tax</strong> to calculate applicable sales and use tax at
            checkout. Tax amounts are calculated based on the buyer&apos;s shipping address and
            applicable state and local rates, and are shown to buyers before completing purchase.
            While Grainline uses commercially reasonable efforts to calculate tax accurately, tax
            calculation is provided on a best-efforts basis. Grainline does not warrant the accuracy
            of tax calculations in all jurisdictions.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">6.6 No Hidden Buyer Fees</h3>
          <p>
            Buyers will not be charged any fees beyond the listed item price, shipping cost
            (calculated at checkout), gift wrapping (if selected), and applicable taxes. All
            amounts are displayed before purchase is completed.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">6.7 Currency</h3>
          <p>
            All transactions on Grainline are conducted in United States Dollars (USD) unless
            otherwise stated.
          </p>
        </section>

        {/* 7 */}
        <section id="shipping">
          <h2 className="text-xl font-semibold mb-4">7. Shipping and Delivery</h2>
          <p>
            Shipping and delivery of items are the sole responsibility of the Maker. Grainline
            provides shipping tools and integrations but is not a carrier and is not responsible for
            shipping outcomes.
          </p>
          <ul className="list-disc pl-6 mt-4 space-y-2">
            <li>
              <strong>Maker responsibility.</strong> Makers are responsible for packaging items
              appropriately, shipping within the stated processing time, and providing tracking
              information to buyers.
            </li>
            <li>
              <strong>Processing times are estimates.</strong> Listed processing times represent the
              Maker&apos;s estimated preparation time and are not guarantees of delivery dates. Actual
              shipping times depend on the carrier and are beyond Grainline&apos;s and most Makers&apos;
              control.
            </li>
            <li>
              <strong>Carrier delays.</strong> Grainline is not responsible for delays caused by
              carriers, customs, weather events, natural disasters, or other circumstances beyond our
              reasonable control.
            </li>
            <li>
              <strong>Risk of loss.</strong> Risk of loss or damage to items transfers to the Buyer
              upon delivery of the item to the carrier for shipment. Buyers should consider purchasing
              shipping insurance for high-value items where available.
            </li>
            <li>
              <strong>Local pickup.</strong> Where a Maker offers local pickup, Buyers and Makers are
              responsible for coordinating the pickup directly. Grainline is not responsible for any
              issues arising from local pickup arrangements.
            </li>
            <li>
              <strong>Address errors.</strong> Grainline and Makers are not responsible for
              non-delivery resulting from inaccurate or incomplete shipping information provided by
              the Buyer.
            </li>
          </ul>

          <h3 className="text-base font-semibold mt-6 mb-2">7.7 Estimated Delivery Dates</h3>
          <p>
            The Platform calculates estimated delivery dates based on the Maker&apos;s stated
            processing time plus estimated carrier transit time plus a grace period. These dates are
            estimates only and are not guaranteed delivery dates. Actual delivery depends on carrier
            performance, weather, customs, and other factors beyond Grainline&apos;s control.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">7.8 Multi-Seller Orders</h3>
          <p>
            Orders containing items from multiple Makers are processed as separate transactions, one
            per Maker. Each transaction has its own processing timeline, shipping, and tracking.
            Buyers will receive separate shipments from each Maker.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">7.9 Shipping Labels</h3>
          <p>
            Grainline offers an optional shipping label purchase feature for Makers. When a Maker
            purchases a shipping label through the Platform, the label cost is deducted from the
            Maker&apos;s payout via their Stripe Connect account. Label pricing is provided by
            third-party carriers through Shippo and Grainline does not mark up label costs. Purchased
            labels may be voided subject to carrier policies.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">7.10 Cross-Border Orders</h3>
          <p>
            For orders shipped between the United States and Canada, the Buyer is responsible for any
            applicable customs duties, import taxes, or brokerage fees assessed by the destination
            country. Grainline does not collect customs duties at checkout. Makers are responsible for
            accurately completing any required customs documentation.
          </p>
        </section>

        {/* 8 */}
        <section id="returns">
          <h2 className="text-xl font-semibold mb-4">8. Returns, Refunds, and Cancellations</h2>

          <h3 className="text-base font-semibold mt-6 mb-2">8.1 Maker Return Policies</h3>
          <p>
            Each Maker sets their own return and refund policy, which must be clearly stated in their
            shop policies. Buyers should review the Maker&apos;s policy before purchasing. Grainline
            does not guarantee any particular return or refund policy across all Makers. Return
            eligibility, timeframes, and conditions vary by Maker.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">8.2 Custom and Made-to-Order Items</h3>
          <p>
            Custom, personalized, and made-to-order items may be non-refundable or subject to limited
            return rights per the Maker&apos;s stated policy. Buyers acknowledge that custom items
            are created specifically for them and agree to the Maker&apos;s cancellation terms before
            placing custom orders. Review the listing and Maker policies carefully before purchasing
            any custom item.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">8.3 Grainline Case System Refunds</h3>
          <p>
            In cases escalated to Grainline staff for resolution, Grainline may at its sole
            discretion issue:
          </p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>Full refund to the Buyer</li>
            <li>Partial refund to the Buyer</li>
            <li>No refund (case dismissed)</li>
          </ul>
          <p className="mt-3">
            Grainline&apos;s decision in case resolution is <strong>final and binding</strong> on both
            parties. Refunds issued through the Case System are processed to the original payment
            method and typically appear within <strong>5–10 business days</strong>, subject to your
            bank&apos;s processing time.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">8.4 Chargebacks</h3>
          <p>
            Buyers agree to contact Grainline through the Case System before initiating a chargeback
            with their payment provider. Initiating a chargeback without first attempting resolution
            through the Case System may result in account suspension. Fraudulent chargebacks —
            including chargebacks initiated after a Case System resolution in Grainline&apos;s favor —
            may result in permanent account termination and referral to appropriate authorities.
            Grainline reserves the right to contest chargebacks where the Case System was not used
            in good faith.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">8.5 Seller-Initiated Refunds</h3>
          <p>
            Makers may issue full or partial refunds to Buyers at any time through the Grainline
            seller dashboard. Refunds are processed through Stripe and typically appear within
            5–10 business days. Grainline&apos;s platform fee is not refunded when a Maker
            voluntarily issues a refund. For full refunds of in-stock items, the item&apos;s stock
            quantity is automatically restored.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">8.6 Grainline Is Not the Seller</h3>
          <p>
            Grainline is a marketplace platform. When Buyers purchase from Makers on Grainline, the
            contract of sale is between the Buyer and the Maker — not Grainline. Grainline may
            facilitate dispute resolution but is not the seller of record and is not liable for item
            quality, defects, or misrepresentation by Makers. Grainline&apos;s maximum liability in
            connection with any transaction is limited to the transaction amount.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">8.7 Pre-Shipment Cancellations</h3>
          <p>
            Buyers may request cancellation of an order prior to shipment by contacting the Maker
            through the Platform&apos;s messaging system. Makers should process cancellation requests
            promptly and issue a full refund for orders not yet shipped. Once an item has been shipped
            or a Maker has begun work on a made-to-order item, the order cannot be cancelled and is
            subject to the Maker&apos;s return policy. Makers may cancel an order prior to shipment if
            they are unable to fulfill it, in which case a full refund must be issued to the Buyer
            promptly.
          </p>
        </section>

        {/* 9 */}
        <section id="disputes">
          <h2 className="text-xl font-semibold mb-4">9. Dispute Resolution (Cases)</h2>

          <h3 className="text-base font-semibold mt-6 mb-2">9.1 Grainline Case System</h3>
          <p>
            Grainline provides a Case System for resolving disputes between Buyers and Makers. The
            Case System is the <strong>required first step</strong> for any transaction dispute before
            escalation to Grainline staff or initiation of a chargeback.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">9.2 Opening a Case</h3>
          <p>Buyers may open a case after the estimated delivery date has passed if:</p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>The item was not received</li>
            <li>The item significantly differs from the listing description</li>
            <li>The item arrived damaged</li>
            <li>The wrong item was received</li>
          </ul>
          <p className="mt-3">
            Buyers must open cases within <strong>30 days</strong> of the estimated delivery date.
            Cases opened after this window may be rejected at Grainline&apos;s discretion. If the
            Maker did not provide tracking information, the 30-day window begins from the order date
            rather than the estimated delivery date.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">9.3 Case Process</h3>
          <p>Upon case opening:</p>
          <ul className="list-disc pl-6 mt-3 space-y-2">
            <li>The Maker has <strong>48 hours</strong> to respond. Failure to respond may result in an automatic finding in favor of the Buyer.</li>
            <li>Both parties enter the &quot;IN_DISCUSSION&quot; phase and have the opportunity to resolve the matter directly.</li>
            <li>If unresolved after the discussion period (48 hours after discussion begins), either party may escalate to Grainline staff.</li>
            <li>Escalated cases are reviewed by Grainline staff. Review and determination are typically completed within <strong>3–5 business days</strong>.</li>
          </ul>

          <h3 className="text-base font-semibold mt-6 mb-2">9.4 Grainline&apos;s Role in Cases</h3>
          <p>When reviewing escalated cases, Grainline staff will:</p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>Review all communications between Buyer and Maker</li>
            <li>Review order details, photos, and tracking information</li>
            <li>Make a determination at Grainline&apos;s sole discretion</li>
            <li>Issue a resolution: full refund, partial refund, or case dismissal</li>
          </ul>
          <p className="mt-3">
            Grainline&apos;s case decisions are <strong>final and binding</strong> on both parties.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">9.5 Case Abuse</h3>
          <p>
            Filing false or fraudulent cases, providing false information during case proceedings, or
            using the Case System to harass Makers or Buyers may result in account suspension or
            permanent termination.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">9.6 Limitation on Cases</h3>
          <p>
            The Case System is not a substitute for legal proceedings. For disputes exceeding
            $10,000, parties are encouraged to seek independent legal counsel. Grainline&apos;s
            maximum liability in connection with any case is limited to the transaction amount, as
            further described in Section 13.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">9.7 Binding Arbitration</h3>
          <p>
            Disputes between users and Grainline that cannot be resolved through the Case System are
            subject to binding arbitration as described in Section 15.
          </p>
        </section>

        {/* 10 */}
        <section id="prohibited">
          <h2 className="text-xl font-semibold mb-4">10. Prohibited Activities</h2>
          <p>
            You agree not to engage in any of the following prohibited activities in connection with
            your use of the Platform:
          </p>
          <ul className="list-disc pl-6 mt-4 space-y-2">
            <li>Engaging in or facilitating fraudulent transactions, misrepresentation, or deceptive practices</li>
            <li>Listing, selling, or purchasing counterfeit goods or items that infringe on any intellectual property rights</li>
            <li>Misrepresenting item origin, materials, or handmade status</li>
            <li>Selling mass-produced items as handmade</li>
            <li>Dropshipping items without clear disclosure to buyers</li>
            <li>Harassing, threatening, intimidating, or abusing other users</li>
            <li>Circumventing, attempting to circumvent, or assisting others in circumventing platform fees</li>
            <li>Creating, soliciting, or posting fake, incentivized, or misleading reviews</li>
            <li>Manipulating review scores or offering incentives for positive reviews</li>
            <li>Sending spam, unsolicited commercial messages, or chain messages through the Platform</li>
            <li>Circumventing the Case System by initiating chargebacks without good faith use of the Case System first</li>
            <li>Scraping, crawling, or using automated tools to access Platform data without Grainline&apos;s express written permission</li>
            <li>Interfering with or disrupting Platform security, servers, or networks</li>
            <li>Using the Platform to facilitate money laundering, tax evasion, or any other illegal financial activity</li>
            <li>Listing items prohibited under Section 4.3 of these Terms</li>
            <li>Creating multiple accounts to circumvent suspensions, bans, or platform policies</li>
            <li>Impersonating any person or entity, including Grainline staff or other users</li>
            <li>Collecting or harvesting other users&apos; personal information without consent</li>
            <li>Reverse engineering, decompiling, or disassembling any part of the Platform</li>
            <li>Violating any applicable local, state, national, or international law or regulation</li>
            <li>Creating or using fake accounts, bots, or automated tools to manipulate search rankings, listing visibility, review scores, or platform metrics</li>
            <li>Coordinating with other users to artificially inflate ratings or manipulate the Platform</li>
            <li>Using the Platform to solicit off-platform transactions or to circumvent Grainline fees</li>
            <li>Providing false product safety information or misrepresenting compliance with applicable laws and regulations</li>
            <li>Accessing or attempting to access the Platform after your account has been suspended or terminated, whether through a new account, another user&apos;s account, or any other means</li>
          </ul>
          <p className="mt-4">
            Grainline reserves the right to investigate and take appropriate legal action against
            anyone who violates these prohibitions, including removing prohibited content, suspending
            or terminating accounts, and reporting to law enforcement authorities.
          </p>
        </section>

        {/* 11 */}
        <section id="ip">
          <h2 className="text-xl font-semibold mb-4">11. Intellectual Property</h2>

          <h3 className="text-base font-semibold mt-6 mb-2">11.1 Grainline IP</h3>
          <p>
            All platform content, logos, designs, software, and trademarks are owned by Grainline
            and protected by applicable intellectual property laws. You may not use, copy, reproduce,
            distribute, or create derivative works from Grainline IP without Grainline&apos;s prior
            written consent.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">11.2 User Content License</h3>
          <p>
            You retain ownership of all content you submit to the Platform (&quot;User Content&quot;),
            including listing photos, descriptions, messages, and blog posts. By submitting User
            Content, you grant Grainline a <strong>non-exclusive, worldwide, royalty-free,
            sublicensable license</strong> to use, display, reproduce, and distribute such content
            in connection with operating, promoting, and improving the Platform. This license
            survives removal of your listing but not deletion of your account.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">11.3 DMCA Takedown Notices</h3>
          <p>
            Grainline respects intellectual property rights and complies with the Digital Millennium
            Copyright Act (DMCA). To report copyright infringement, send a written notice to{" "}
            <a href="mailto:legal@thegrainline.com" className="underline">legal@thegrainline.com</a>{" "}
            with the subject line &quot;DMCA Notice.&quot; Your notice must include:
          </p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>Identification of the copyrighted work claimed to be infringed</li>
            <li>Identification of the allegedly infringing material and its location on the Platform</li>
            <li>Your contact information (name, address, phone, email)</li>
            <li>A statement of good faith belief that the use is not authorized by the copyright owner, its agent, or the law</li>
            <li>A statement, under penalty of perjury, that the information in the notice is accurate and that you are the copyright owner or authorized to act on the owner&apos;s behalf</li>
            <li>Your physical or electronic signature</li>
          </ul>
          <p className="mt-3">Grainline will process valid DMCA notices promptly.</p>

          <h3 className="text-base font-semibold mt-6 mb-2">11.4 Counter-Notices</h3>
          <p>
            If you believe content was wrongfully removed in response to a DMCA notice, you may
            submit a counter-notice to{" "}
            <a href="mailto:legal@thegrainline.com" className="underline">legal@thegrainline.com</a>{" "}
            following standard DMCA counter-notice requirements, including a statement under penalty
            of perjury that you have a good faith belief the material was removed by mistake or
            misidentification.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">11.5 Repeat Infringers</h3>
          <p>
            Grainline will suspend or terminate the accounts of users who are determined to be repeat
            infringers of intellectual property rights.
          </p>
        </section>

        {/* 12 */}
        <section id="privacy">
          <h2 className="text-xl font-semibold mb-4">12. Privacy</h2>
          <p>
            Your privacy is important to us. Please review our{" "}
            <Link href="/privacy" className="underline hover:text-neutral-600">Privacy Policy</Link>,
            which is incorporated into these Terms by reference and explains how we collect, use,
            and share information about you.
          </p>
          <ul className="list-disc pl-6 mt-4 space-y-2">
            <li><strong>Stripe</strong> — payment data shared with Stripe for payment processing; Grainline does not store full card information.</li>
            <li><strong>Shippo</strong> — shipping address information shared with Shippo to generate labels and obtain rate quotes.</li>
            <li><strong>Clerk</strong> — authentication data processed by Clerk, our identity provider.</li>
            <li><strong>Resend</strong> — email address and name shared with Resend for transactional and marketing email delivery.</li>
          </ul>
        </section>

        {/* 13 */}
        <section id="disclaimers">
          <h2 className="text-xl font-semibold mb-4">13. Disclaimers and Limitation of Liability</h2>

          <h3 className="text-base font-semibold mt-6 mb-2">13.1 &quot;As Is&quot; Disclaimer</h3>
          <p>
            THE PLATFORM IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT
            WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED
            WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND
            NON-INFRINGEMENT. GRAINLINE DOES NOT WARRANT THAT THE PLATFORM WILL BE UNINTERRUPTED,
            ERROR-FREE, SECURE, OR FREE OF VIRUSES OR OTHER HARMFUL COMPONENTS.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">13.2 No Warranty for Listings</h3>
          <p>
            GRAINLINE MAKES NO WARRANTY WITH RESPECT TO ANY ITEM LISTED OR SOLD ON THE PLATFORM,
            INCLUDING WARRANTIES OF QUALITY, SAFETY, FITNESS FOR PURPOSE, OR ACCURACY OF LISTING
            DESCRIPTIONS. GRAINLINE IS NOT RESPONSIBLE FOR THE ACTIONS, PRODUCTS, OR CONTENT OF
            ANY MAKER OR BUYER.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">13.3 No Warranty of Authenticity</h3>
          <p>
            GRAINLINE MAKES NO REPRESENTATION OR WARRANTY THAT ANY ITEM LISTED ON THE PLATFORM IS
            HANDMADE, AUTHENTIC, ORIGINAL, SAFE, OR ACCURATELY DESCRIBED BY THE MAKER. GRAINLINE
            DOES NOT INSPECT ITEMS BEFORE OR AFTER LISTING. BUYERS PURCHASE ENTIRELY AT THEIR OWN
            RISK WITH RESPECT TO ITEM AUTHENTICITY AND QUALITY.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">13.4 Limitation of Liability</h3>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT WILL GRAINLINE, ITS
            OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, OR AFFILIATES BE LIABLE FOR ANY INDIRECT,
            INCIDENTAL, SPECIAL, CONSEQUENTIAL, PUNITIVE, OR EXEMPLARY DAMAGES ARISING OUT OF OR IN
            CONNECTION WITH YOUR USE OF OR INABILITY TO USE THE PLATFORM, EVEN IF GRAINLINE HAS BEEN
            ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
          </p>
          <p className="mt-4">
            IN ANY CASE, GRAINLINE&apos;S MAXIMUM AGGREGATE LIABILITY TO YOU FOR ALL CLAIMS ARISING
            OUT OF OR RELATING TO THESE TERMS OR YOUR USE OF THE PLATFORM WILL NOT EXCEED THE
            GREATER OF (A) THE TOTAL FEES PAID BY YOU TO GRAINLINE IN THE 12 MONTHS IMMEDIATELY
            PRECEDING THE EVENT GIVING RISE TO THE CLAIM, OR (B) ONE HUNDRED U.S. DOLLARS ($100).
          </p>
          <p className="mt-4">
            Some jurisdictions do not allow the exclusion of certain warranties or the limitation of
            liability for certain types of damages. In such jurisdictions, Grainline&apos;s liability
            will be limited to the fullest extent permitted by applicable law.
          </p>
        </section>

        {/* 14 */}
        <section id="indemnification">
          <h2 className="text-xl font-semibold mb-4">14. Indemnification</h2>
          <p>
            You agree to defend, indemnify, and hold harmless Grainline and its officers, directors,
            employees, agents, and affiliates from and against any and all claims, damages, losses,
            costs, and expenses (including reasonable attorneys&apos; fees) arising out of or
            relating to:
          </p>
          <ul className="list-disc pl-6 mt-4 space-y-2">
            <li>Your use of or access to the Platform</li>
            <li>Your violation of these Terms</li>
            <li>Your violation of any applicable law, regulation, or third-party right</li>
            <li>Any item you list, sell, or purchase on the Platform</li>
            <li>Any User Content you submit to the Platform</li>
            <li>Any dispute between you and another user of the Platform</li>
            <li>Your failure to collect, report, or remit any taxes that are your responsibility</li>
            <li>Any Commission Request you post, any interest you express in a Commission Request, or any transaction arising from the Commission Room</li>
          </ul>
          <p className="mt-4">
            Grainline reserves the right, at its own expense, to assume the exclusive defense and
            control of any matter otherwise subject to indemnification by you. You will not settle
            any claim without Grainline&apos;s prior written consent.
          </p>
        </section>

        {/* 15 */}
        <section id="governing-law">
          <h2 className="text-xl font-semibold mb-4">15. Governing Law and Dispute Resolution</h2>

          <h3 className="text-base font-semibold mt-6 mb-2">15.1 Governing Law</h3>
          <p>
            These Terms and any dispute arising out of or relating to these Terms or your use of the
            Platform will be governed by and construed in accordance with the laws of the
            <strong> State of Texas</strong>, without regard to its conflict of law principles.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">15.2 Binding Arbitration</h3>
          <p>
            EXCEPT AS PROVIDED IN SECTION 15.4, ANY DISPUTE, CLAIM, OR CONTROVERSY ARISING OUT OF
            OR RELATING TO THESE TERMS OR YOUR USE OF THE PLATFORM WILL BE RESOLVED BY BINDING
            ARBITRATION ADMINISTERED BY THE AMERICAN ARBITRATION ASSOCIATION (&quot;AAA&quot;) IN
            ACCORDANCE WITH ITS CONSUMER ARBITRATION RULES, RATHER THAN IN COURT. The arbitration
            will be conducted in Travis County, Texas, unless both parties agree otherwise.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">15.3 Class Action Waiver</h3>
          <p>
            YOU AND GRAINLINE EACH AGREE THAT ANY DISPUTE RESOLUTION PROCEEDING WILL BE CONDUCTED
            ONLY ON AN INDIVIDUAL BASIS AND NOT IN A CLASS, CONSOLIDATED, OR REPRESENTATIVE ACTION.
            If a court or arbitrator finds this waiver unenforceable in any instance, then the entire
            arbitration agreement will be void as to that claim only.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">15.4 Small Claims Court Exception</h3>
          <p>
            Either party may bring an individual claim in small claims court in Travis County, Texas
            if the claim qualifies for small claims jurisdiction.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">15.5 Arbitration Opt-Out</h3>
          <p>
            You may opt out of the arbitration agreement by sending written notice to{" "}
            <a href="mailto:legal@thegrainline.com" className="underline">legal@thegrainline.com</a>{" "}
            within <strong>30 days</strong> of first creating your account or first accepting these
            Terms. Your opt-out notice must include your name, email address, and a clear statement
            that you are opting out of arbitration. Opting out does not affect any other provision
            of these Terms.
          </p>
        </section>

        {/* 16 */}
        <section id="termination">
          <h2 className="text-xl font-semibold mb-4">16. Termination</h2>
          <p>
            <strong>By you.</strong> You may terminate your account at any time by contacting us at{" "}
            <a href="mailto:legal@thegrainline.com" className="underline">legal@thegrainline.com</a>.
            Termination does not entitle you to a refund of any fees paid.
          </p>
          <p className="mt-4">
            <strong>By Grainline.</strong> Grainline may suspend or permanently terminate your account
            and access to the Platform at any time, with or without notice, for any violation of these
            Terms, for fraudulent or harmful conduct, or for any other reason at Grainline&apos;s sole
            discretion.
          </p>
          <p className="mt-4">
            <strong>Effect of termination.</strong> Upon termination, your right to use the Platform
            immediately ceases, and Grainline may delete your account data in accordance with our
            Privacy Policy. Upon account suspension or termination by Grainline: all active listings
            are immediately hidden from the Platform; new purchases of the user&apos;s items are
            blocked; open Commission Requests are closed. For existing unfulfilled orders, Grainline
            may at its discretion require the suspended seller to complete fulfillment, arrange
            alternative fulfillment, or issue refunds to affected buyers. Grainline does not hold,
            freeze, or seize funds in a seller&apos;s Stripe Connect account — sellers retain access
            to funds already transferred to their Stripe account. Grainline maintains a permanent
            audit log of all suspension and termination actions. Users who believe their account was
            suspended in error may contact{" "}
            <a href="mailto:legal@thegrainline.com" className="underline">legal@thegrainline.com</a>{" "}
            to request review. Grainline will respond within 30 days but is not obligated to reverse
            any suspension decision. The following provisions survive termination: Sections 4.15, 6,
            9, 10, 11, 13, 14, 15, 22.6, and all payment obligations that accrued prior to
            termination.
          </p>
        </section>

        {/* 17 */}
        <section id="changes">
          <h2 className="text-xl font-semibold mb-4">17. Changes to Terms</h2>
          <p>
            Grainline reserves the right to modify these Terms at any time. For material changes, we
            will provide at least <strong>30 days&apos; advance notice</strong> by sending an email
            to the address associated with your account and posting a prominent notice on the Platform.
          </p>
          <p className="mt-4">
            Your continued use of the Platform after the effective date of any revised Terms
            constitutes your acceptance of the updated Terms. If you do not agree to the revised Terms,
            you must stop using the Platform and may terminate your account.
          </p>
          <p className="mt-4">
            Non-material changes (clarifications, typographical corrections, changes required by law)
            may take effect immediately upon posting without advance notice.
          </p>
        </section>

        {/* 18 */}
        <section id="contact">
          <h2 className="text-xl font-semibold mb-4">18. Contact Information</h2>
          <p>If you have any questions, concerns, or complaints about these Terms, please contact us:</p>
          <address className="not-italic mt-4 space-y-1 text-neutral-700">
            <p><strong>Grainline</strong></p>
            <p>Email: <a href="mailto:legal@thegrainline.com" className="underline hover:text-neutral-600">legal@thegrainline.com</a></p>
            <p>[YOUR ADDRESS]</p>
          </address>
          <p className="mt-4 text-sm text-neutral-500">
            For DMCA notices, email{" "}
            <a href="mailto:legal@thegrainline.com" className="underline">legal@thegrainline.com</a>{" "}
            with subject line &quot;DMCA Notice&quot;.
          </p>
        </section>

        {/* 19 */}
        <section id="guild">
          <h2 className="text-xl font-semibold mb-4">19. Guild Verification Program</h2>

          <h3 className="text-base font-semibold mt-6 mb-2">19.1 Program Overview</h3>
          <p>
            Grainline offers a voluntary <strong>Guild Verification Program</strong> for Makers.
            Verification badges indicate that a Maker has met certain criteria as described below.{" "}
            <strong>BADGES DO NOT CONSTITUTE AN ENDORSEMENT BY GRAINLINE OF PRODUCT QUALITY,
            SAFETY, OR AUTHENTICITY.</strong> Grainline makes no warranty regarding verified Makers
            or their products.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">19.2 Guild Member Badge</h3>
          <p>The Guild Member badge indicates that a Maker has:</p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>Completed their maker profile</li>
            <li>Maintained at least 5 active listings</li>
            <li>Achieved $250 in completed sales</li>
            <li>Maintained good account standing</li>
            <li>Submitted an application reviewed and approved by Grainline staff</li>
          </ul>
          <p className="mt-3 text-sm text-neutral-600">
            The Guild Member badge confirms profile completeness and platform standing only.
            It does not guarantee product quality, authenticity, or business legitimacy.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">19.3 Guild Master Badge</h3>
          <p>The Guild Master badge indicates that a Maker has:</p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>Met all Guild Member requirements</li>
            <li>Maintained a minimum 4.5-star average rating</li>
            <li>Demonstrated consistent on-time shipping performance</li>
            <li>Maintained high buyer response rates</li>
            <li>Completed a minimum number of transactions</li>
            <li>Maintained no unresolved disputes for a minimum of 6 consecutive months</li>
          </ul>
          <p className="mt-3 text-sm text-neutral-600">
            This badge reflects historical performance metrics only. Past performance does not
            guarantee future performance. Grainline makes no warranty regarding Guild Master verified
            Makers.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">19.4 Badge Maintenance and Revocation</h3>
          <p>Verification badges are subject to periodic review. Badges may be revoked if:</p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>Maker no longer meets the criteria for the badge</li>
            <li>Maker violates Grainline&apos;s Terms of Service</li>
            <li>Maker&apos;s performance metrics fall below required thresholds</li>
            <li>Fraudulent activity is detected</li>
          </ul>
          <p className="mt-3">
            Grainline reserves the right to revoke badges at any time at its sole discretion with or
            without prior notice. Makers whose badges have been revoked may reapply when they believe
            they meet all applicable criteria. Reapplication is subject to the same review process as
            initial applications. Previous revocation does not automatically disqualify a Maker from
            future badge eligibility.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">19.5 FTC Disclosure</h3>
          <p>
            In compliance with FTC guidelines, Grainline clearly discloses the specific criteria for
            each badge level. Verification badges are <strong>not paid endorsements</strong> and
            cannot be purchased. Badge criteria are applied consistently to all Makers. The existence
            of a verification badge does not constitute a testimonial, endorsement, or guarantee of
            product quality by Grainline.
          </p>
        </section>

        {/* 20 */}
        <section id="force-majeure">
          <h2 className="text-xl font-semibold mb-4">20. Force Majeure</h2>
          <p>
            Neither party shall be liable to the other for delays or failures in performance resulting
            from causes beyond their reasonable control, including without limitation: acts of God,
            natural disasters, pandemics, epidemics, government actions or restrictions, war, terrorism,
            civil unrest, labor disputes, power or telecommunications infrastructure failures, or
            actions of third-party service providers.
          </p>
          <p className="mt-4">
            Makers experiencing force majeure events must notify affected Buyers promptly through the
            Platform&apos;s messaging system and work toward resolution or offer refunds where
            fulfillment is impossible. Grainline shall not be liable for any failure or delay in
            providing the Platform caused by force majeure events.
          </p>
          <p className="mt-4">
            Force majeure does not excuse payment obligations that have already accrued.
          </p>
        </section>

        {/* 21 */}
        <section id="accessibility">
          <h2 className="text-xl font-semibold mb-4">21. Accessibility</h2>
          <p>
            Grainline is committed to making our Platform accessible to users with disabilities. We
            strive to conform to the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA
            standards. We continually work to improve the accessibility of the Platform.
          </p>
          <p className="mt-4">
            If you experience accessibility barriers while using the Platform, or if you need
            information in an alternate format, please contact us at{" "}
            <a href="mailto:legal@thegrainline.com" className="underline">legal@thegrainline.com</a>.
            We will make reasonable efforts to accommodate your accessibility needs.
          </p>
        </section>

        {/* 22 */}
        <section id="commission-room">
          <h2 className="text-xl font-semibold mb-4">22. Commission Room</h2>

          <h3 className="text-base font-semibold mt-6 mb-2">22.1 Overview</h3>
          <p>
            The Commission Room is a feature that allows Buyers to post requests for custom
            woodworking pieces (&quot;Commission Requests&quot;) and allows Makers to express interest
            in fulfilling those requests. The Commission Room is a discovery tool — it is not a
            binding contract, auction, or bidding system.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">22.2 Commission Requests</h3>
          <p>
            Buyers may post Commission Requests describing the type of piece they are looking for,
            including a description, category, estimated budget range, timeline, and optional reference
            images. Commission Requests are displayed publicly on the Commission Room board and may be
            visible to all users of the Platform.
          </p>
          <p className="mt-3">By posting a Commission Request, you acknowledge and agree that:</p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>Your request is non-binding and does not obligate any Maker to respond or perform work</li>
            <li>Budget ranges are estimates provided for Maker reference only and do not constitute a binding price offer</li>
            <li>Reference images you upload are licensed to Grainline under the same terms as other User Content (Section 11.2)</li>
            <li>Grainline does not guarantee that any Maker will respond to your request</li>
            <li>You may close or mark your request as fulfilled at any time</li>
            <li>Commission Requests may expire or be removed by Grainline at its discretion</li>
          </ul>

          <h3 className="text-base font-semibold mt-6 mb-2">22.3 Expressing Interest</h3>
          <p>
            Makers may express interest in a Commission Request, which initiates a direct conversation
            between the Maker and the Buyer through the Platform&apos;s messaging system. Expressing
            interest does not create any contractual obligation to perform work, deliver a product, or
            agree to the Buyer&apos;s stated budget or timeline.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">22.4 Resulting Transactions</h3>
          <p>
            If a Maker and Buyer agree to proceed with a custom order as a result of a Commission
            Request, the resulting transaction must be completed through the Grainline Platform. This
            includes payment processing, order tracking, and fulfillment. Off-platform transactions
            resulting from Commission Room introductions are prohibited under Section 4.17 and may
            result in account suspension for both parties.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">22.5 Local and National Scope</h3>
          <p>
            Buyers may choose to make their Commission Request visible to all Makers nationwide or
            limit visibility to Makers in their geographic area. For location-scoped requests, the
            Buyer&apos;s approximate location (derived from their profile) may be displayed to help
            Makers assess proximity. Grainline uses this location data as described in our Privacy
            Policy.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">22.6 Disputes</h3>
          <p>
            Disputes arising from transactions that originated in the Commission Room are subject to
            the same Case System process described in Section 9. Grainline is not a party to any
            agreement between a Buyer and Maker resulting from a Commission Request and bears no
            liability for the outcome of any such agreement.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">22.7 Commission Room Content</h3>
          <p>
            All content posted in the Commission Room, including request descriptions, reference
            images, and interest messages, is subject to the same content standards and prohibited
            activities described in Sections 10 and 11. Grainline reserves the right to remove any
            Commission Request or related content at its sole discretion.
          </p>
        </section>

        {/* 23 */}
        <section id="following">
          <h2 className="text-xl font-semibold mb-4">23. Following System and Seller Broadcasts</h2>

          <h3 className="text-base font-semibold mt-6 mb-2">23.1 Following Makers</h3>
          <p>
            Users may follow Makers to receive updates about new listings, blog posts, and shop
            announcements in their personalized feed. Following a Maker is voluntary and may be
            reversed (unfollowed) at any time. Follower counts may be displayed publicly on Maker
            profiles.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">23.2 Seller Broadcasts</h3>
          <p>
            Makers may send broadcast messages to their followers. Broadcasts are limited to one per
            seven-day period. Broadcast content is subject to the same content standards and prohibited
            activities described in Section 10. Makers are solely responsible for the content of their
            broadcasts.
          </p>
          <p className="mt-3">Broadcasts may not contain:</p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>Solicitations for off-platform transactions</li>
            <li>Spam, misleading claims, or deceptive content</li>
            <li>Harassment or threats directed at any user</li>
            <li>Content that violates any applicable law</li>
          </ul>
          <p className="mt-3">
            Users who receive unwanted broadcasts may unfollow the Maker at any time, which immediately
            removes them from that Maker&apos;s broadcast audience.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">23.3 Personalized Feed</h3>
          <p>
            The Platform generates a personalized feed of content from Makers you follow. Feed content
            is displayed in reverse chronological order and may include new listings, blog posts, and
            broadcasts. Feed content is retained for up to 90 days.
          </p>
        </section>

        {/* 24 */}
        <section id="blog-content">
          <h2 className="text-xl font-semibold mb-4">24. Blog and Community Content</h2>

          <h3 className="text-base font-semibold mt-6 mb-2">24.1 Blog Posts</h3>
          <p>
            Makers may publish blog posts through the Platform to share stories, techniques, and
            updates about their craft. Blog posts are User Content subject to the content license in
            Section 11.2 and the prohibited activities in Section 10.
          </p>
          <p className="mt-3">
            Grainline reserves the right to remove any blog post at its sole discretion, with or
            without notice, for any reason including violation of these Terms, inappropriate content,
            or any other reason Grainline deems appropriate.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">24.2 Comments</h3>
          <p>
            Users may submit comments on published blog posts. All comments are subject to moderation
            and will not appear publicly until approved by Grainline staff. Grainline reserves the
            right to reject, remove, or edit comments at its sole discretion. Approval of a comment
            does not constitute endorsement of its content.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">24.3 Blog Content Saved by Users</h3>
          <p>
            Users may save blog posts for later reference. Saved blog post data is stored per the
            Privacy Policy.
          </p>
        </section>

        {/* 25 */}
        <section id="ai-review">
          <h2 className="text-xl font-semibold mb-4">25. Automated Content Review</h2>

          <h3 className="text-base font-semibold mt-6 mb-2">25.1 AI-Assisted Review</h3>
          <p>
            Grainline uses automated systems, including artificial intelligence provided by
            third-party services, to review listing content for potential violations of these Terms.
            Listing content including titles, descriptions, and images may be processed by these
            automated systems.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">25.2 Pending Review Status</h3>
          <p>
            Listings may be placed in a &quot;Pending Review&quot; status before becoming publicly
            visible. This may occur for first-time listings, listings flagged by automated review, or
            at Grainline&apos;s discretion. Listings under review are not visible to Buyers but remain
            visible to the Maker in their dashboard.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">25.3 Approval and Rejection</h3>
          <p>
            Listings placed under review will be reviewed by Grainline staff. Approved listings become
            publicly visible. Rejected listings are hidden and the Maker is notified with a reason for
            rejection. Makers may modify rejected listings and resubmit them for review.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">25.4 No Guarantee</h3>
          <p>
            Automated and manual review of listings does not constitute a guarantee or endorsement of
            listing content, product quality, safety, or compliance with applicable laws. Makers remain
            solely responsible for the accuracy and legality of their listings regardless of whether
            those listings have been reviewed or approved by Grainline.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">25.5 Limitation of Liability for Review Decisions</h3>
          <p>
            Grainline shall not be liable for any damages arising from the delay, rejection, or removal
            of listings through the review process, whether automated or manual. Grainline&apos;s review
            decisions are made at its sole discretion and are not subject to appeal beyond the
            resubmission process described in Section 25.3.
          </p>
        </section>

        {/* 26 */}
        <section id="vacation-mode">
          <h2 className="text-xl font-semibold mb-4">26. Vacation Mode</h2>
          <p>
            Makers may activate Vacation Mode to temporarily hide their listings from the Platform and
            prevent new orders. When Vacation Mode is active:
          </p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>All of the Maker&apos;s listings are hidden from browse, search, and the homepage</li>
            <li>New purchases of the Maker&apos;s items are blocked</li>
            <li>Existing unfulfilled orders at the time of activation must still be fulfilled within original processing deadlines</li>
            <li>Vacation Mode does not extend processing deadlines or estimated delivery dates for existing orders</li>
            <li>Buyers may still send messages to the Maker</li>
            <li>The Maker&apos;s profile remains accessible but displays a vacation notice</li>
          </ul>
          <p className="mt-3">
            Makers may deactivate Vacation Mode at any time to restore their listings and resume
            accepting orders. Prolonged or excessive use of Vacation Mode may affect Guild badge
            eligibility.
          </p>
        </section>

        {/* 27 */}
        <section id="reviews-ratings">
          <h2 className="text-xl font-semibold mb-4">27. Reviews and Ratings</h2>

          <h3 className="text-base font-semibold mt-6 mb-2">27.1 Posting Reviews</h3>
          <p>
            Buyers who have completed a purchase may post a review of the item and transaction within
            90 days of order completion. Only verified purchasers may leave reviews. You may not
            review your own listings or products.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">27.2 Review Content</h3>
          <p>
            Reviews must be honest, accurate, and based on your genuine experience with the item and
            transaction. Reviews may include text, a star rating, and photos of the item received.
            Review photos are User Content subject to the license in Section 11.2.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">27.3 Prohibited Review Practices</h3>
          <p>
            The following are prohibited and may result in review removal and account suspension:
          </p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>Fake or fabricated reviews</li>
            <li>Reviews written by someone other than the verified purchaser</li>
            <li>Reviews offered in exchange for compensation, discounts, or free products</li>
            <li>Retaliatory reviews intended to harm a Maker in response to a dispute outcome</li>
            <li>Reviews containing threats, harassment, hate speech, or personally identifiable information about the Maker</li>
            <li>Reviews that are irrelevant to the item or transaction</li>
          </ul>

          <h3 className="text-base font-semibold mt-6 mb-2">27.4 Seller Replies</h3>
          <p>
            Makers may post one public reply to each review. Seller replies are subject to the same
            content standards as reviews and may be removed by Grainline if they violate these Terms.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">27.5 Helpfulness Voting</h3>
          <p>
            Users may vote on whether a review is helpful. Vote counts are displayed publicly.
            Manipulation of helpfulness votes through coordinated action or automated tools is
            prohibited.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">27.6 Review Removal</h3>
          <p>
            Grainline reserves the right to remove any review at its sole discretion for violation of
            these Terms or for any other reason. Grainline is not obligated to remove reviews that a
            Maker disagrees with, provided the review does not violate these Terms.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">27.7 Aggregate Ratings</h3>
          <p>
            Star ratings and review counts displayed on listings and Maker profiles are calculated
            automatically from verified purchase reviews. These aggregate ratings are provided for
            informational purposes only and do not constitute a guarantee or endorsement by Grainline.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">27.8 Reviews After Account Deletion</h3>
          <p>
            If a reviewer&apos;s account is deleted, their reviews may be retained in anonymized form
            (with the reviewer&apos;s name removed or replaced with a generic identifier) to maintain
            the integrity of Maker ratings and the trust of future Buyers.
          </p>
        </section>

        {/* 28 */}
        <section id="messaging">
          <h2 className="text-xl font-semibold mb-4">28. Messaging</h2>

          <h3 className="text-base font-semibold mt-6 mb-2">28.1 Platform Messaging</h3>
          <p>
            The Platform provides a messaging system for communication between Buyers and Makers.
            Messages are stored on Grainline&apos;s servers and retained per the Privacy Policy
            (currently 3 years).
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">28.2 Permitted Use</h3>
          <p>
            The messaging system is intended for communications related to purchases, custom orders,
            commission requests, and other legitimate Platform activity. You may not use the messaging
            system to:
          </p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>Solicit off-platform transactions (see Section 4.17)</li>
            <li>Send spam, chain messages, or unsolicited commercial messages</li>
            <li>Harass, threaten, or abuse other users</li>
            <li>Share illegal content or content that violates these Terms</li>
            <li>Collect personal information from other users for purposes unrelated to a Platform transaction</li>
          </ul>

          <h3 className="text-base font-semibold mt-6 mb-2">28.3 File Attachments</h3>
          <p>
            Users may send images and PDF files through the messaging system. File attachments are
            subject to the same content standards as other User Content.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">28.4 System Messages</h3>
          <p>
            The Platform may generate automated system messages in conversations, including commission
            interest notifications, custom order cards, and transaction confirmations. System messages
            are generated automatically and are not editable by users.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">28.5 Message Review</h3>
          <p>
            Grainline may access and review message content in connection with dispute resolution,
            fraud investigation, Terms enforcement, or in response to legal process. Grainline does
            not routinely monitor private messages but reserves the right to do so to maintain
            Platform safety and integrity.
          </p>
        </section>

        {/* 29 */}
        <section id="notifications">
          <h2 className="text-xl font-semibold mb-4">29. Notifications and Communication Preferences</h2>

          <h3 className="text-base font-semibold mt-6 mb-2">29.1 In-App Notifications</h3>
          <p>
            Grainline sends in-app notifications for Platform activity including new orders, messages,
            case updates, shipping updates, and follower activity. Transactional notifications related
            to orders and account security cannot be disabled.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">29.2 Customizable Notifications</h3>
          <p>
            Users may customize their notification preferences through their account settings.
            Customizable notifications include new listing alerts from followed Makers, seller
            broadcasts, new follower notifications, and review notifications.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">29.3 Email Communications</h3>
          <p>
            Grainline sends transactional emails related to orders, cases, and account activity. These
            emails are necessary for Platform operation and cannot be opted out of while your account
            is active. Marketing and promotional emails may be unsubscribed from at any time via the
            unsubscribe link in any email or by contacting{" "}
            <a href="mailto:privacy@thegrainline.com" className="underline">privacy@thegrainline.com</a>.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">29.4 Back-in-Stock Notifications</h3>
          <p>
            Users may subscribe to receive a notification when an out-of-stock item becomes available
            again. This subscription data is stored per the Privacy Policy and may be removed at any
            time.
          </p>
        </section>

        {/* 30 */}
        <section id="algorithmic">
          <h2 className="text-xl font-semibold mb-4">30. Algorithmic Features and Recommendations</h2>
          <p>The Platform uses algorithms to personalize your experience, including:</p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>&quot;Similar Items&quot; recommendations on listing pages based on category, tags, and price range</li>
            <li>&quot;Buyer Favorites&quot; and &quot;Fresh from the Workshop&quot; sections on the homepage based on favorites count and recency</li>
            <li>Search relevance ranking based on engagement metrics, recency, and availability</li>
            <li>Personalized feed content based on which Makers you follow</li>
          </ul>
          <p className="mt-4">
            These algorithms use Platform activity data (views, favorites, sales) and do not use
            external data or build profiles for third-party use. Grainline does not guarantee the
            accuracy or relevance of algorithmic recommendations. The presence of an item in a
            recommendation section does not constitute an endorsement by Grainline.
          </p>
        </section>

        {/* 31 */}
        <section id="geo-restrictions">
          <h2 className="text-xl font-semibold mb-4">31. Geographic Restrictions</h2>
          <p>
            The Platform is currently available to users located in the United States and Canada.
            Access from other countries may be restricted. Grainline reserves the right to modify
            geographic availability at any time. Geographic restrictions are determined by IP address
            and may not be circumvented using virtual private networks (VPNs) or similar tools.
          </p>
        </section>

        {/* 32 */}
        <section id="private-listings">
          <h2 className="text-xl font-semibold mb-4">32. Private and Reserved Listings</h2>
          <p>
            Makers may create private listings that are visible only to a specific Buyer, typically in
            connection with a custom order arrangement. Private listings do not appear in search,
            browse, the homepage, or any public page. Private listings are subject to all the same
            Terms as public listings, including payment processing through the Platform, the Case
            System, and content standards. Buyers who receive a private listing link may purchase the
            item through normal checkout.
          </p>
        </section>

        {/* 33 */}
        <section id="general-provisions">
          <h2 className="text-xl font-semibold mb-4">33. General Provisions</h2>

          <h3 className="text-base font-semibold mt-6 mb-2">33.1 Severability</h3>
          <p>
            If any provision of these Terms is held to be invalid, illegal, or unenforceable by a
            court of competent jurisdiction, that provision shall be modified to the minimum extent
            necessary to make it enforceable, or if modification is not possible, severed from these
            Terms. The remaining provisions shall continue in full force and effect.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">33.2 Waiver</h3>
          <p>
            Grainline&apos;s failure to enforce any right or provision of these Terms shall not
            constitute a waiver of that right or provision. A waiver of any provision shall be
            effective only if in writing and signed by Grainline. No waiver of any provision shall be
            deemed a further or continuing waiver of that provision or any other provision.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">33.3 Assignment</h3>
          <p>
            You may not assign or transfer these Terms or any rights or obligations hereunder without
            Grainline&apos;s prior written consent. Grainline may assign or transfer these Terms, in
            whole or in part, without restriction and without notice to you, including in connection
            with a merger, acquisition, corporate reorganization, or sale of all or substantially all
            of its assets. Subject to the foregoing, these Terms shall bind and inure to the benefit
            of the parties and their respective successors and permitted assigns.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">33.4 Electronic Communications</h3>
          <p>
            By creating an account on the Platform, you consent to receive communications from
            Grainline electronically, including by email, in-app notifications, and notices posted on
            the Platform. You agree that all agreements, notices, disclosures, and other communications
            that Grainline provides to you electronically satisfy any legal requirement that such
            communications be in writing.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">33.5 Headings</h3>
          <p>
            The section and subsection headings in these Terms are for convenience of reference only
            and shall not affect the interpretation or construction of any provision.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">33.6 Relationship of the Parties</h3>
          <p>
            Nothing in these Terms shall be construed to create a partnership, joint venture,
            employment, or agency relationship between you and Grainline. You have no authority to
            bind Grainline in any respect.
          </p>
        </section>

      </div>

      {/* Footer attorney note */}
      <div className="mt-16 pt-6 border-t border-neutral-200 text-xs text-neutral-500 text-center">
        These documents were prepared as a draft for attorney review. Grainline recommends consulting
        qualified legal counsel before relying on these documents.
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm text-neutral-500">
        <Link href="/privacy" className="underline hover:text-neutral-700">Privacy Policy</Link>
        <Link href="/" className="underline hover:text-neutral-700">Back to Grainline</Link>
      </div>
    </main>
  );
}
