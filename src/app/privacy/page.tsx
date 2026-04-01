// src/app/privacy/page.tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Grainline Privacy Policy — how we collect, use, and protect your personal information on the Grainline handmade woodworking marketplace.",
  robots: { index: true, follow: true },
};

const TOC = [
  { id: "introduction",  label: "1. Introduction" },
  { id: "information",   label: "2. Information We Collect" },
  { id: "use",           label: "3. How We Use Your Information" },
  { id: "sharing",       label: "4. Information We Share" },
  { id: "cookies",       label: "5. Cookies and Tracking" },
  { id: "retention",     label: "6. Data Retention" },
  { id: "rights",        label: "7. Your Rights" },
  { id: "children",      label: "8. Children's Privacy" },
  { id: "security",      label: "9. Security" },
  { id: "transfers",     label: "10. International Data Transfers" },
  { id: "third-party",   label: "11. Third-Party Links" },
  { id: "changes",       label: "12. Changes to This Policy" },
  { id: "contact",       label: "13. Contact Us" },
];

export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12 print:py-4">

      {/* Header */}
      <div className="mb-10">
        <p className="text-sm text-neutral-500 mb-2">Legal</p>
        <h1 className="text-4xl font-bold mb-2">Privacy Policy</h1>
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
        <section id="introduction">
          <h2 className="text-xl font-semibold mb-4">1. Introduction</h2>
          <p>
            Grainline (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates the Grainline
            marketplace platform at thegrainline.com (the &quot;Platform&quot;). We are committed to
            protecting your privacy and handling your personal information with care and transparency.
          </p>
          <p className="mt-4">
            This Privacy Policy explains what information we collect about you, how we use it, with
            whom we share it, and the choices you have regarding your information. It applies to all
            users of the Platform, including Makers (sellers) and Buyers.
          </p>
          <p className="mt-4">
            By using the Platform, you consent to the practices described in this Privacy Policy. If
            you do not agree with this policy, please do not use the Platform.
          </p>
          <p className="mt-4">
            This policy should be read together with our{" "}
            <Link href="/terms" className="underline hover:text-neutral-600">Terms of Service</Link>.
          </p>
        </section>

        {/* 2 */}
        <section id="information">
          <h2 className="text-xl font-semibold mb-4">2. Information We Collect</h2>
          <p>
            We collect information you provide to us directly, information generated through your use
            of the Platform, and information from third-party services.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">2.1 Account Information</h3>
          <p>
            When you create an account, we collect your name, email address, and password (hashed and
            managed securely through our authentication provider, Clerk). We may also collect a
            profile photo if you upload one.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">2.2 Profile Information</h3>
          <p>
            Makers may provide additional profile information including a shop display name, biography,
            story, profile and banner photos, workshop photos, social media links, website URL, years
            in business, shop policies, and location (city and state for public display; precise
            latitude/longitude for map features, only if you choose to set it).
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">2.3 Transaction Information</h3>
          <p>
            When you make or receive a purchase, we collect information about the transaction including
            item details, amounts, shipping address, and order status. Payment card data is processed
            directly by Stripe and is not stored by Grainline. We do store Stripe transaction
            identifiers, payout information, and sales tax records as required by law.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">2.4 Communications</h3>
          <p>
            We store messages sent between users through the Platform&apos;s messaging system,
            including buyer-seller conversations, custom order requests, and case messages. We also
            store reviews, blog posts, and comments you submit.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">2.5 Usage Data</h3>
          <p>
            We collect information about how you use the Platform, including pages visited, listings
            viewed and clicked, searches performed, filters applied, features used, and the times and
            dates of your activities.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">2.6 Device Information</h3>
          <p>
            We automatically collect certain technical information when you use the Platform, including
            your IP address, browser type and version, operating system, device type, and referring
            URL. This information is used for security, fraud prevention, and platform analytics.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">2.7 Location Data</h3>
          <p>
            We collect approximate location data (city, state, country) derived from your IP address
            for general analytics and to improve location-based features. For map features, Makers
            may optionally provide precise workshop location coordinates. Your precise GPS coordinates
            are stored securely but only your approximate location (city/region level) is displayed
            publicly on the Grainline map. You may remove your location at any time through your
            dashboard settings. We do not track your precise device GPS location without your
            explicit permission.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">2.8 Photo Metadata</h3>
          <p>
            Photos you upload may contain embedded EXIF metadata, which can include location
            coordinates, device information, and timestamps. Grainline makes commercially reasonable
            efforts to strip location-related EXIF data from uploaded photos. Photos are processed
            through our upload provider (UploadThing) which may retain or strip metadata according to
            their own practices. Other non-identifying EXIF metadata may be retained for technical
            purposes.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">2.9 Newsletter and Marketing</h3>
          <p>
            If you subscribe to our newsletter, we collect your email address and optional name. You
            may unsubscribe at any time via the unsubscribe link in any email or by contacting{" "}
            <a href="mailto:privacy@thegrainline.com" className="underline">privacy@thegrainline.com</a>.
            Unsubscribing from marketing emails does not affect transactional emails related to your
            orders or account activity.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">2.10 Cookies and Tracking Technologies</h3>
          <p>
            We use cookies and similar technologies to operate the Platform. See Section 5 for details.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">2.11 Information from Third Parties</h3>
          <p>
            We may receive information about you from third-party services integrated with the
            Platform, including authentication events from Clerk, payment events from Stripe, and
            shipping events from Shippo.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">2.12 Commission Room Data</h3>
          <p>
            Buyers who post Commission Requests provide a description, budget range, timeline,
            category, and optional reference images. This information is displayed publicly on the
            Commission Room board. Location data may be used for locally-scoped requests as described
            in Section 2.7.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">2.13 Following and Feed Data</h3>
          <p>
            We store records of which Makers you follow. Your following activity is used to generate
            your personalized feed and to enable seller broadcasts. Follower counts are displayed
            publicly on Maker profiles.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">2.14 Back-in-Stock Subscriptions</h3>
          <p>
            When you subscribe to receive a notification when an out-of-stock item becomes available,
            we store a record linking your account to that listing. You may unsubscribe at any time
            from the listing page.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">2.15 Seller Performance Metrics</h3>
          <p>
            For Makers participating in the Guild Verification Program, we calculate performance
            metrics including average rating, on-time shipping rate, response rate, total sales, and
            open case count. These metrics are calculated automatically from Platform activity data and
            are used to determine Guild badge eligibility and maintenance.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">2.16 Listing Snapshots</h3>
          <p>
            When a purchase is completed, we capture and store a snapshot of the listing details at
            the time of the transaction, including the title, description, price, images, category,
            tags, and seller name. This snapshot is retained as part of the order record for dispute
            resolution, order history display, and archival purposes.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">2.17 Saved Searches</h3>
          <p>
            If you save a search, we store your search filters including search query, category, price
            range, and tags. You may delete saved searches at any time from your dashboard.
          </p>
        </section>

        {/* 3 */}
        <section id="use">
          <h2 className="text-xl font-semibold mb-4">3. How We Use Your Information</h2>
          <p>We use the information we collect for the following purposes:</p>
          <ul className="list-disc pl-6 mt-4 space-y-2">
            <li>
              <strong>Provide the Platform.</strong> To operate, maintain, and improve the Platform,
              including processing transactions, facilitating communications between users, and
              displaying listings.
            </li>
            <li>
              <strong>Process transactions.</strong> To process payments, issue payouts, calculate
              shipping rates, generate shipping labels, collect and remit sales tax, and fulfill orders.
            </li>
            <li>
              <strong>Tax compliance.</strong> To calculate, collect, and remit applicable sales tax
              as required by marketplace facilitator laws; to generate and issue 1099-K forms as
              required by IRS regulations; and to maintain transaction records for tax and legal
              compliance.
            </li>
            <li>
              <strong>Transactional communications.</strong> To send order confirmations, shipping
              notifications, case updates, review requests, and other communications necessary to
              fulfill your transactions or platform activities.
            </li>
            <li>
              <strong>Marketing communications.</strong> With your consent, to send newsletters,
              promotional emails, and updates about new features. You may opt out at any time by
              clicking &quot;unsubscribe&quot; in any marketing email or contacting{" "}
              <a href="mailto:privacy@thegrainline.com" className="underline">privacy@thegrainline.com</a>.
            </li>
            <li>
              <strong>Fraud prevention and security.</strong> To detect, investigate, and prevent
              fraudulent transactions, abuse, and other harmful activities, and to protect the
              security of the Platform and our users.
            </li>
            <li>
              <strong>Legal compliance.</strong> To comply with applicable laws, regulations, legal
              processes, and governmental requests, including marketplace facilitator tax obligations.
            </li>
            <li>
              <strong>Analytics and improvement.</strong> To analyze usage patterns, understand how
              users interact with the Platform, and improve our features, content, and user experience.
            </li>
            <li>
              <strong>Customer support.</strong> To respond to your inquiries, resolve disputes, and
              provide technical support.
            </li>
            <li>
              <strong>Personalization.</strong> To personalize your experience, including showing
              relevant listings, search results, and recommendations.
            </li>
            <li>
              <strong>Automated content review.</strong> We use automated tools, including artificial
              intelligence provided by third-party services, to review listing content for potential
              violations of our Terms of Service. This review may occur before a listing is made
              publicly visible. Automated review does not replace human judgment — flagged listings
              are reviewed by Grainline staff before final decisions are made.
            </li>
            <li>
              <strong>Seller performance evaluation.</strong> We automatically calculate seller
              performance metrics to determine eligibility for the Guild Verification Program. While
              metrics are calculated automatically, all badge approval and revocation decisions include
              human review.
            </li>
            <li>
              <strong>Algorithmic recommendations.</strong> We use Platform activity data (views,
              favorites, sales, search behavior) to generate personalized recommendations including
              &quot;Similar Items,&quot; &quot;Buyer Favorites,&quot; and search relevance ranking.
              We do not use external data sources or build advertising profiles for these features.
            </li>
          </ul>
        </section>

        {/* 4 */}
        <section id="sharing">
          <h2 className="text-xl font-semibold mb-4">4. Information We Share</h2>

          <h3 className="text-base font-semibold mt-6 mb-2">4.1 Service Providers</h3>
          <p>
            We share your information with the following third-party service providers who process
            data on our behalf:
          </p>
          <ul className="list-disc pl-6 mt-3 space-y-3">
            <li>
              <strong>Stripe</strong> — Payment processing and Stripe Connect payouts. Stripe receives
              payment card data, billing information, and transaction details. Stripe is PCI DSS
              compliant.{" "}
              <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="underline">stripe.com/privacy</a>
            </li>
            <li>
              <strong>Clerk</strong> — User authentication and account management. Clerk receives
              your name, email address, and authentication events.{" "}
              <a href="https://clerk.com/privacy" target="_blank" rel="noopener noreferrer" className="underline">clerk.com/privacy</a>
            </li>
            <li>
              <strong>Shippo</strong> — Shipping label generation and carrier rate quotes. Shippo
              receives sender and recipient name and address information for orders.{" "}
              <a href="https://goshippo.com/privacy" target="_blank" rel="noopener noreferrer" className="underline">goshippo.com/privacy</a>
            </li>
            <li>
              <strong>Resend</strong> — Transactional and marketing email delivery. Resend receives
              your email address and name for sending emails on our behalf.
            </li>
            <li>
              <strong>UploadThing</strong> — Cloud storage for images and files you upload to the
              Platform, including listing photos, profile images, and review photos.
            </li>
            <li>
              <strong>Sentry</strong> — Error tracking and performance monitoring. Sentry receives
              anonymized technical information about errors and performance issues, which may include
              IP addresses and browser information. We do not intentionally send personally
              identifiable information to Sentry.
            </li>
            <li>
              <strong>OpenAI</strong> — Automated content review. Listing content (titles,
              descriptions) may be processed by OpenAI&apos;s systems to detect potential Terms of
              Service violations. We send only listing content — not seller names, emails, or other
              personal data.{" "}
              <a href="https://openai.com/privacy" target="_blank" rel="noopener noreferrer" className="underline">openai.com/privacy</a>
            </li>
            <li>
              <strong>Upstash</strong> — Rate limiting and security infrastructure. Upstash receives
              anonymized request identifiers (hashed IP addresses and user IDs) to enforce rate limits
              and prevent abuse. No personally identifiable information is stored beyond hashed
              identifiers.{" "}
              <a href="https://upstash.com/privacy" target="_blank" rel="noopener noreferrer" className="underline">upstash.com/privacy</a>
            </li>
            <li>
              <strong>OpenStreetMap (Nominatim)</strong> — Reverse geocoding. When Makers set their
              workshop location, coordinates may be sent to OpenStreetMap&apos;s Nominatim API to
              determine city and state information for the Makers Map and city-level pages. No
              personally identifiable information beyond coordinates is sent.{" "}
              <a href="https://nominatim.org" target="_blank" rel="noopener noreferrer" className="underline">nominatim.org</a>
            </li>
            <li>
              <strong>OpenStreetMap Tile Servers</strong> — Map display. When you view the Makers
              Map, your browser loads map images directly from OpenStreetMap&apos;s tile servers.
              OpenStreetMap receives your IP address and standard browser information in connection
              with serving map tiles.{" "}
              <a href="https://www.openstreetmap.org/privacy" target="_blank" rel="noopener noreferrer" className="underline">openstreetmap.org/privacy</a>
            </li>
            <li>
              <strong>UptimeRobot</strong> — Platform availability monitoring. UptimeRobot makes
              periodic requests to our servers to detect downtime. No user data is shared with
              UptimeRobot.{" "}
              <a href="https://uptimerobot.com/privacy" target="_blank" rel="noopener noreferrer" className="underline">uptimerobot.com/privacy</a>
            </li>
            <li>
              <strong>Vercel</strong> — Cloud hosting and infrastructure. The Platform is hosted on
              Vercel&apos;s servers. Vercel processes web requests and may access request data
              including IP addresses in the course of providing hosting services.{" "}
              <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="underline">vercel.com/legal/privacy-policy</a>
            </li>
            <li>
              <strong>Cloudflare</strong> — DNS, content delivery network, and security. Cloudflare
              processes web traffic to the Platform and provides DDoS protection and bot management.
              Cloudflare may set security cookies (__cf_bm) and process IP addresses.{" "}
              <a href="https://www.cloudflare.com/privacypolicy" target="_blank" rel="noopener noreferrer" className="underline">cloudflare.com/privacypolicy</a>
            </li>
            <li>
              <strong>Neon</strong> — Database hosting. Our PostgreSQL database is hosted on
              Neon&apos;s cloud infrastructure. Neon stores and processes Platform data on our behalf
              as a data processor.{" "}
              <a href="https://neon.tech/privacy" target="_blank" rel="noopener noreferrer" className="underline">neon.tech/privacy</a>
            </li>
            <li>
              <strong>Video Providers</strong> — Blog post embeds. Blog posts may contain embedded
              videos from YouTube (Google) or Vimeo. When you view a page containing an embedded
              video, the video provider receives your IP address and may set cookies according to
              their own privacy policies.{" "}
              <a href="https://www.youtube.com/about/policies" target="_blank" rel="noopener noreferrer" className="underline">youtube.com/about/policies</a>{" "}
              |{" "}
              <a href="https://vimeo.com/privacy" target="_blank" rel="noopener noreferrer" className="underline">vimeo.com/privacy</a>
            </li>
          </ul>

          <h3 className="text-base font-semibold mt-6 mb-2">4.2 Between Users</h3>
          <p>
            For order fulfillment, we share necessary information between Buyers and Makers. This
            includes sharing the Buyer&apos;s name and shipping address with the Maker, and displaying
            the Maker&apos;s shop information and policies to Buyers.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.3 Legal Requirements</h3>
          <p>
            We may disclose your information to law enforcement, government authorities (including
            tax authorities), or other third parties when we believe in good faith that disclosure
            is required by law, to protect our rights or the rights of others, to prevent fraud or
            illegal activity, or to respond to an emergency that threatens safety.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.4 Business Transfers</h3>
          <p>
            If Grainline is involved in a merger, acquisition, financing, reorganization, bankruptcy,
            or sale of all or a portion of its assets, your information may be transferred as part of
            that transaction. We will notify you via email and/or prominent notice on the Platform
            before your information becomes subject to a different privacy policy.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.5 Tax Authorities</h3>
          <p>
            As a marketplace facilitator, Grainline may share transaction information with state and
            local tax authorities as required to fulfill our sales tax collection and remittance
            obligations. Grainline may also share Maker payment information with the IRS as required
            for 1099-K reporting.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.6 Buyer-Maker Transaction Data</h3>
          <p>
            When a Buyer completes a purchase, their name and shipping address are shared with the
            Maker solely for order fulfillment purposes. Makers are prohibited from using this
            information for any purpose other than fulfilling the specific order. Makers may not
            contact Buyers outside the Platform without the Buyer&apos;s consent. If a Buyer includes
            a gift note or selects gift wrapping, the gift note text is shared with the Maker along
            with the order details for fulfillment purposes.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.7 Stripe Connected Account Agreement</h3>
          <p>
            Makers who use Stripe Connect to receive payments are subject to the Stripe Connected
            Account Agreement. Stripe&apos;s data practices for connected accounts are governed by
            Stripe&apos;s Privacy Policy. By connecting a Stripe account, Makers consent to Stripe&apos;s
            collection and processing of their information as described in Stripe&apos;s policies.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">4.8 What We Do NOT Do</h3>
          <ul className="list-disc pl-6 mt-3 space-y-2">
            <li>We do <strong>not</strong> sell, rent, or trade personal information to third parties for their marketing purposes.</li>
            <li>We do <strong>not</strong> share your data for third-party advertising.</li>
            <li>We do <strong>not</strong> use your data to build advertising profiles for external use.</li>
          </ul>
        </section>

        {/* 5 */}
        <section id="cookies">
          <h2 className="text-xl font-semibold mb-4">5. Cookies and Tracking</h2>
          <p>
            We use cookies and similar tracking technologies to operate and improve the Platform.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">5.1 Types of Cookies We Use</h3>
          <ul className="list-disc pl-6 mt-3 space-y-2">
            <li>
              <strong>Essential cookies.</strong> Necessary for the Platform to function. These include
              authentication session cookies (managed by Clerk) and shopping cart cookies. You cannot
              opt out of essential cookies while using the Platform.
            </li>
            <li>
              <strong>Functional cookies.</strong> Remember your preferences and settings, such as
              recently viewed listings (stored as a client-side cookie) and notification preferences.
            </li>
            <li>
              <strong>Analytics cookies.</strong> Help us understand how users interact with the
              Platform. We use this data in aggregate to improve our features. These cookies are
              optional.
            </li>
            <li>
              <strong>Rate limiting cookies.</strong> We use httpOnly cookies to prevent abuse of view
              and click tracking endpoints. These cookies are set per listing and per IP address,
              contain no personally identifiable information, and expire within 24 hours.
            </li>
            <li>
              <strong>Recently viewed cookie.</strong> We store a client-side cookie containing the
              IDs of up to 10 recently viewed listings to display your browsing history. This cookie
              expires after 30 days and contains only listing identifiers — no personal information.
            </li>
            <li>
              <strong>Payment processing cookies.</strong> Stripe.js, our payment processor&apos;s
              client-side library, may set cookies and collect device fingerprint information on pages
              where payment functionality is present. This data is used by Stripe for fraud prevention
              and is governed by Stripe&apos;s Privacy Policy and Cookie Policy.
            </li>
          </ul>

          <h3 className="text-base font-semibold mt-6 mb-2">5.2 How to Disable Cookies</h3>
          <p>
            Most browsers allow you to refuse cookies or to alert you when cookies are being sent.
            You can typically find these settings in your browser&apos;s &quot;Settings,&quot;
            &quot;Preferences,&quot; or &quot;Privacy&quot; menu. Disabling essential cookies will
            prevent you from logging in and using most Platform features.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">5.3 Do Not Track</h3>
          <p>
            Some browsers offer a &quot;Do Not Track&quot; (DNT) signal. There is no industry-standard
            technology for recognizing or honoring DNT signals. We do not currently respond to DNT
            signals. However, we do not engage in cross-site tracking, third-party behavioral
            advertising, or sale of personal information regardless of DNT settings.
          </p>
        </section>

        {/* 6 */}
        <section id="retention">
          <h2 className="text-xl font-semibold mb-4">6. Data Retention</h2>
          <ul className="list-disc pl-6 space-y-3">
            <li>
              <strong>Account data.</strong> Retained while your account is active plus 30 days after
              a deletion request is processed. Upon account deletion, personal data is anonymized
              within 30 days except where retention is legally required.
            </li>
            <li>
              <strong>Transaction records.</strong> Order and payment records are retained for a
              minimum of <strong>7 years</strong> to comply with tax, accounting, and legal
              requirements.
            </li>
            <li>
              <strong>Sales tax records.</strong> Sales tax records, including transaction details
              relevant to tax remittance, are retained for a minimum of <strong>4 years</strong> per
              Texas Comptroller requirements and applicable state laws.
            </li>
            <li>
              <strong>1099-K records.</strong> IRS reporting records are retained for a minimum of
              7 years as required by federal tax law.
            </li>
            <li>
              <strong>Messages.</strong> Messages between users are retained for <strong>3 years</strong>{" "}
              then deleted, unless the messages are subject to an open case, legal hold, or fraud
              investigation. After account deletion, messages may be retained in anonymized form
              for safety and fraud prevention for the remainder of the 3-year period.
            </li>
            <li>
              <strong>Notification data.</strong> Read notifications are automatically deleted after
              <strong> 90 days</strong>. Unread notifications are retained until read or until
              account deletion.
            </li>
            <li>
              <strong>Legal holds.</strong> If your information is subject to a legal hold, dispute,
              investigation, or law enforcement request, we may retain it beyond the standard
              retention periods.
            </li>
            <li>
              <strong>Administrative action logs.</strong> Records of administrative actions including
              account suspensions, content removal decisions, listing review decisions, and Guild badge
              actions are retained permanently for legal compliance and audit purposes.
            </li>
            <li>
              <strong>Seller performance metrics.</strong> Calculated seller metrics are refreshed
              monthly and retained for the duration of the seller&apos;s account. Historical daily
              view and click data is retained for 2 years.
            </li>
            <li>
              <strong>Commission Requests.</strong> Commission Request data (descriptions, reference
              images, interest records) is retained for the lifetime of the request plus 1 year after
              the request is closed, fulfilled, or expired.
            </li>
            <li>
              <strong>Following data.</strong> Records of which Makers you follow are retained while
              your account is active and deleted upon account deletion.
            </li>
          </ul>
        </section>

        {/* 7 */}
        <section id="rights">
          <h2 className="text-xl font-semibold mb-4">7. Your Rights</h2>
          <p>
            Depending on your location, you may have certain rights regarding your personal
            information. We honor the following rights for all users regardless of location:
          </p>
          <ul className="list-disc pl-6 mt-4 space-y-2">
            <li>
              <strong>Access.</strong> Request a copy of the personal information we hold about you.
            </li>
            <li>
              <strong>Correction.</strong> Correct inaccurate or incomplete personal information. You
              can update most account information directly in your account settings.
            </li>
            <li>
              <strong>Deletion.</strong> Request deletion of your account and associated personal
              data, subject to our legal retention obligations (e.g., transaction records required
              for tax compliance cannot be deleted before the required retention period).
            </li>
            <li>
              <strong>Data portability.</strong> Request an export of your personal data in a
              commonly used, machine-readable format. Data export requests are processed manually and
              fulfilled within 30 days of a verified request. Exports typically include your account
              information, transaction history, messages, reviews, and listing data in JSON or CSV
              format.
            </li>
            <li>
              <strong>Opt out of marketing.</strong> Opt out of marketing emails at any time by
              clicking &quot;unsubscribe&quot; in any marketing email or contacting{" "}
              <a href="mailto:privacy@thegrainline.com" className="underline">privacy@thegrainline.com</a>.
              Opting out does not affect transactional emails related to your orders or account.
            </li>
          </ul>

          <h3 className="text-base font-semibold mt-6 mb-2">7.1 How to Exercise Your Rights</h3>
          <p>
            To exercise any of the rights described in this section, please contact us at{" "}
            <a href="mailto:privacy@thegrainline.com" className="underline">privacy@thegrainline.com</a>.
            We will respond within 30 days (or within the timeframe required by applicable law). We
            may need to verify your identity before processing your request.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">7.2 California Residents (CCPA)</h3>
          <p>
            If you are a California resident, you have the following rights under the California
            Consumer Privacy Act (CCPA) and California Privacy Rights Act (CPRA):
          </p>
          <ul className="list-disc pl-6 mt-3 space-y-2">
            <li><strong>Right to know</strong> — the categories and specific pieces of personal information we have collected, used, disclosed, or sold about you in the past 12 months</li>
            <li><strong>Right to delete</strong> — personal information we have collected, subject to certain exceptions</li>
            <li><strong>Right to correct</strong> — inaccurate personal information we maintain about you</li>
            <li><strong>Right to opt out of sale or sharing</strong> — we do not sell or share personal information for cross-context behavioral advertising, so this right is not applicable</li>
            <li><strong>Right to limit use of sensitive personal information</strong> — we do not use sensitive personal information beyond what is necessary to provide the Platform</li>
            <li><strong>Right to non-discrimination</strong> — we will not discriminate against you for exercising your CCPA/CPRA rights</li>
          </ul>
          <p className="mt-3">
            To exercise California rights, contact us at{" "}
            <a href="mailto:privacy@thegrainline.com" className="underline">privacy@thegrainline.com</a>.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">7.3 Texas Residents (TDPSA)</h3>
          <p>
            Texas residents have rights under the Texas Data Privacy and Security Act (TDPSA),
            including rights to:
          </p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li>Access your personal data</li>
            <li>Correct inaccuracies in your personal data</li>
            <li>Delete personal data you have provided to us</li>
            <li>Obtain a copy of your personal data in a portable format</li>
            <li>Opt out of the processing of personal data for targeted advertising (we do not engage in targeted advertising)</li>
            <li>Opt out of the sale of personal data (we do not sell personal data)</li>
            <li>Appeal a decision regarding a rights request</li>
          </ul>
          <p className="mt-3">
            To exercise Texas TDPSA rights or to appeal a rights decision, contact us at{" "}
            <a href="mailto:privacy@thegrainline.com" className="underline">privacy@thegrainline.com</a>.
            We will respond within 45 days as required by the TDPSA, with a possible 45-day extension
            where reasonably necessary.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2">7.4 EU, EEA, and UK Residents (GDPR)</h3>
          <p>
            If you are located in the European Union, European Economic Area, or United Kingdom, you
            have rights under the General Data Protection Regulation (GDPR) or UK GDPR, including:
          </p>
          <ul className="list-disc pl-6 mt-3 space-y-1">
            <li><strong>Right of access</strong> — obtain confirmation of whether we process your data and a copy of that data</li>
            <li><strong>Right to rectification</strong> — have inaccurate personal data corrected</li>
            <li><strong>Right to erasure (&quot;right to be forgotten&quot;)</strong> — have your personal data deleted in certain circumstances</li>
            <li><strong>Right to restrict processing</strong> — limit how we use your data in certain circumstances</li>
            <li><strong>Right to data portability</strong> — receive your data in a structured, machine-readable format</li>
            <li><strong>Right to object</strong> — object to processing based on legitimate interests or for direct marketing</li>
            <li><strong>Rights related to automated decision-making</strong> — not be subject to solely automated decisions that produce significant effects</li>
          </ul>
          <p className="mt-3">
            <strong>Note regarding automated processing:</strong> Grainline uses automated systems to
            calculate seller performance metrics and to perform initial content review of listings.
            However, all consequential decisions (Guild badge approval/revocation, listing rejection,
            account suspension) include human review. You have the right to request human review of
            any automated decision that significantly affects you.
          </p>
          <p className="mt-3">
            <strong>Legal basis for processing:</strong> We process your data on the basis of contract
            performance (to provide the Platform), legal obligation (tax compliance, legal holds), and
            legitimate interests (fraud prevention, security, analytics). Marketing is processed with
            your consent.
          </p>
          <p className="mt-3">
            <strong>Data transfers to the US</strong> are covered by Standard Contractual Clauses
            where required. You also have the right to lodge a complaint with your local data
            protection supervisory authority.
          </p>
          <p className="mt-3">
            To exercise GDPR rights, contact{" "}
            <a href="mailto:privacy@thegrainline.com" className="underline">privacy@thegrainline.com</a>.
          </p>
        </section>

        {/* 8 */}
        <section id="children">
          <h2 className="text-xl font-semibold mb-4">8. Children&apos;s Privacy</h2>
          <p>
            The Platform is not directed to children under 13 years of age. We do not knowingly
            collect personal information from children under 13. If we learn that we have collected
            personal information from a child under 13, we will delete that information as promptly
            as possible.
          </p>
          <p className="mt-4">
            If you are a parent or guardian and believe that your child under 13 has provided personal
            information to us, please contact us at{" "}
            <a href="mailto:privacy@thegrainline.com" className="underline">privacy@thegrainline.com</a>{" "}
            and we will take appropriate action.
          </p>
        </section>

        {/* 9 */}
        <section id="security">
          <h2 className="text-xl font-semibold mb-4">9. Security</h2>
          <p>
            We implement industry-standard security measures designed to protect your personal
            information against unauthorized access, disclosure, alteration, and destruction:
          </p>
          <ul className="list-disc pl-6 mt-4 space-y-2">
            <li>
              <strong>Encryption in transit.</strong> All data transmitted between your browser and
              our servers is encrypted using HTTPS/TLS.
            </li>
            <li>
              <strong>Access controls.</strong> Access to personal data is limited to Grainline
              personnel who need it to perform their job functions.
            </li>
            <li>
              <strong>Payment security.</strong> Payment card data is handled exclusively by Stripe,
              which maintains PCI DSS Level 1 compliance. Grainline never stores full card numbers.
            </li>
            <li>
              <strong>Authentication security.</strong> Account authentication is managed by Clerk,
              which provides secure password hashing, multi-factor authentication options, and
              session management.
            </li>
            <li>
              <strong>Error monitoring.</strong> We use Sentry for error tracking to detect and
              respond to security incidents promptly.
            </li>
          </ul>
          <p className="mt-4">
            <strong>No guarantee.</strong> Despite our efforts, no security system is completely
            impenetrable. We cannot guarantee that unauthorized parties will never circumvent our
            security measures or misuse your information.
          </p>
          <p className="mt-4">
            <strong>Data breach notification.</strong> In the event of a data breach that affects
            your personal information, we will notify you and applicable regulatory authorities
            within <strong>72 hours</strong> of becoming aware of the breach, to the extent required
            by applicable law.
          </p>
        </section>

        {/* 10 */}
        <section id="transfers">
          <h2 className="text-xl font-semibold mb-4">10. International Data Transfers</h2>
          <p>
            Grainline is based in the United States. If you use the Platform from outside the United
            States, your information will be transferred to, stored, and processed in the United
            States, where data protection laws may differ from those in your country.
          </p>
          <p className="mt-4">
            By using the Platform, you consent to the transfer of your information to the United
            States and its processing there in accordance with this Privacy Policy.
          </p>
          <p className="mt-4">
            For transfers from the EU/EEA or UK, we rely on appropriate safeguards as required by
            applicable law, including <strong>Standard Contractual Clauses</strong> with our service
            providers where applicable.
          </p>
        </section>

        {/* 11 */}
        <section id="third-party">
          <h2 className="text-xl font-semibold mb-4">11. Third-Party Links</h2>
          <p>
            The Platform may contain links to third-party websites, social media platforms, and
            services. These third parties have their own privacy policies, and Grainline is not
            responsible for their privacy practices or content. We encourage you to review the
            privacy policies of any third-party sites you visit.
          </p>
          <p className="mt-4">
            Maker shop profiles may link to external websites, social media accounts, and portfolios.
            These links are provided by Makers and Grainline has no control over the privacy
            practices of these external sites.
          </p>
        </section>

        {/* 12 */}
        <section id="changes">
          <h2 className="text-xl font-semibold mb-4">12. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. For material changes, we will
            provide at least <strong>30 days&apos; advance notice</strong> by sending an email to
            the address associated with your account and posting a prominent notice on the Platform.
          </p>
          <p className="mt-4">
            Your continued use of the Platform after the effective date of any revised Privacy Policy
            constitutes your acceptance of the updated policy. If you do not agree with the revised
            policy, you must stop using the Platform and may request deletion of your account.
          </p>
          <p className="mt-4">
            The &quot;Last Updated&quot; date at the top of this page will always reflect the date
            of the most recent revision.
          </p>
        </section>

        {/* 13 */}
        <section id="contact">
          <h2 className="text-xl font-semibold mb-4">13. Contact Us</h2>
          <p>
            If you have any questions, concerns, or requests regarding this Privacy Policy or our
            data practices, please contact us:
          </p>
          <address className="not-italic mt-4 space-y-1 text-neutral-700">
            <p><strong>Grainline — Privacy Team</strong></p>
            <p>Email: <a href="mailto:privacy@thegrainline.com" className="underline hover:text-neutral-600">privacy@thegrainline.com</a></p>
            <p>[YOUR ADDRESS]</p>
          </address>
          <p className="mt-4 text-sm text-neutral-500">
            For general legal inquiries:{" "}
            <a href="mailto:legal@thegrainline.com" className="underline">legal@thegrainline.com</a>
          </p>
        </section>

      </div>

      {/* Footer attorney note */}
      <div className="mt-16 pt-6 border-t border-neutral-200 text-xs text-neutral-500 text-center">
        These documents were prepared as a draft for attorney review. Grainline recommends consulting
        qualified legal counsel before relying on these documents.
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm text-neutral-500">
        <Link href="/terms" className="underline hover:text-neutral-700">Terms of Service</Link>
        <Link href="/" className="underline hover:text-neutral-700">Back to Grainline</Link>
      </div>
    </main>
  );
}
