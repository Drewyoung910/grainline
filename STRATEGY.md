# Grainline Strategy and Roadmap

Operational notes and strategic direction. AGENTS.md is the codebase contract (what is built, how it works, what must be preserved). This file is for what hasn't been built yet, why, and in what order. Update at the end of any session that produces strategic decisions.

## Immediate priorities

### SavedSearch Phase-B operating decision (2026-07-19)

Finish Bucket A before starting any Notification/Bucket-B design. The separate
SavedSearch FORCE release waits through the full Phase-A skew window plus a
safety margin and a post-skew canary. Before promotion, rotate the migration
owner credential to invalidate old owner-backed deployments and prove the old
credential and owner application sessions are gone. Neon’s migration owner is
the explicit BYPASSRLS service role, while the normal runtime remains constrained.
Controlled owner maintenance and the separate database-first emergency
DISABLE/ENABLE/FORCE path must both remain tested; externalize the owner secret
from production Functions before Bucket B.

### Homepage discovery hierarchy decision (2026-07-15)

Keep the local-maker map directly beneath the hero and floating marketplace stats. It is Grainline's clearest marketplace differentiator, but it should remain a compact discovery band so inventory appears after a short scroll rather than becoming a second full-screen gate.

Preserve this homepage order: hero → stats → local-maker map → Top Picks → Shop by Category → New Arrivals → Makers You Follow → In the Workshop → From the Blog. Do not put a large editorial feature ahead of the first listing row.

### Brand terminology decision (2026-07-15)

Do not globally rename makers to shops. Preserve a three-part vocabulary:

- **Maker** means the person and their craft identity. Use it for community, trust, local discovery, commissions, Guild/Founding recognition, stories, following, and messaging.
- **Shop** means the maker's storefront or a commercial destination/action. Use it for "Visit Shop," profile/settings language, opening a shop, and search copy such as "Search pieces, shops, and more…".
- **Seller** means the transactional/legal role. Keep it in payments, refunds, disputes, staff tooling, schema, APIs, and internal code; avoid it in ordinary buyer discovery copy.

Use "Find Shops Near You" for the homepage hero CTA and local-map heading, where the buyer is choosing a commercial destination. Keep the supporting copy centered on independent woodworkers and do not imply that map pins are guaranteed walk-in retail locations. Internal `SellerProfile` naming and `/makers/...` SEO routes stay unchanged.

### Compliance systems to build before scale

Do not market these as fully implemented until the workflows exist in code and have attorney review.

- **INFORM Consumers Act high-volume seller workflow.** Current Stripe Connect onboarding collects baseline identity and payout information, but Grainline has not built a dedicated high-volume seller threshold tracker, 10-day verification queue, annual recertification flow, or buyer-facing disclosure/reporting workflow. Build before marketplace volume makes the INFORM workflow legally operationally relevant.
- **Privacy-control expansion.** Current product does not sell/share personal information or run third-party behavioral advertising, so GPC does not change current behavior. If that changes, add first-class `Sec-GPC` handling and persistence before enabling the feature.

### `/why-grainline` and `/why-sell-on-grainline` SHIPPED (2026-05-12)

Both landing pages are live.
- `/why-grainline` (buyer) lives in `src/app/why-grainline/page.tsx`. Sections: hero, handmade-trust problem with two-column comparison, four trust-mechanism cards, badge ladder (Founding/Guild Member/Guild Master with live counts), American-made stat bar with map link, buyer protection step-by-step, espresso final CTA.
- `/why-sell-on-grainline` (seller) lives in `src/app/why-sell-on-grainline/page.tsx`. Sections: hero, four-platform fee comparison table (Grainline/Etsy/Faire/Amazon Handmade), Etsy take-rate trap deep dive, Founding Maker scarcity counter, what-we-dont-do, what-you-get six-card grid, risk reversal, espresso final CTA. CTA links use Clerk auth state to send signed-in users straight to `/dashboard` and signed-out users to `/sign-up?redirect_url=/dashboard`.

Both are wired into the Shop and Sell footer columns respectively, added to `middleware.ts` `isPublic`, and added to `sitemap.ts` at priority 0.8 monthly. Live `prisma.sellerProfile.count({ where: { isFoundingMaker: true } })` reads power the "X of 250 spots left" counter on the seller page and the "X of 250 granted" pill on the buyer page.

Revisit when: catalog hits ~75 listings (refresh stats and screenshots), Etsy fees change (refresh comparison table), or Drew wants to test conversion variants on the seller landing.

### Reddit launch posts

Post to: r/EtsySellers, r/woodworking, r/SmallBusiness. NOT r/Etsy main (mods nuke competitor posts).

Each post should:
- Open with "I'm not selling anything" disclaimer.
- Lead with the Etsy fee math problem (specific numbers, including Offsite Ads on shipping).
- Ask for the first 10 sellers + critics + collaborators, not for signups.
- Include concrete technical specifics (Stripe Connect, Texas marketplace facilitator law) that defuse vibe-coding suspicion.
- Drop the URL once, near the bottom.

Be ready in the comment thread to answer specifics about Stripe Connect refund accounting, AI moderation pipeline, dispute escalation, and shipping rate sourcing. Those answers are the real credibility-builder.

### llms.txt is live at `/public/llms.txt`

Already shipped. Revisit if the canonical pitch changes or scope expands beyond woodworking.

## First 10 sellers playbook

The only number that matters for the next 60 days. Do not try to scale recruitment until 10 active sellers are posting.

1. **Etsy poaching, gentle.** Search Etsy for "Austin TX walnut", "Houston handmade cutting board", etc. Filter to 4.8+ rating, 100+ sales, photos that don't look stock. Pull 50 shops. Find their off-Etsy presence (Instagram bio link to personal site is the usual path). Send a personal note about a specific piece of theirs. Offer Founding Maker status + white-glove migration.

2. **Pitch the badge, not the platform.** "Founding Maker #7" is more meaningful than "join my new website". Status + scarcity + permanence does the work.

3. **White-glove migration.** Offer to import their best 5 listings yourself. You type, they review and click publish. Stripe Connect is the only manual step on their end. This kills the #1 friction (re-uploading photos and descriptions).

4. **Be visible in the maker world.** r/woodworking Show-Off Sunday. Texas Woodworkers Guild meetups. Austin/Houston/Dallas local woodworking groups. Don't promote. Be present.

5. **Texas first.** Drew is in Texas. Regional density is more credible than scattered national sellers. "10 Texas makers, 0% commission for 3 months, here's the URL" is a coherent story.

6. **Skip influencer marketing.** Wrong stage, wrong margin. Real makers don't follow influencers, they follow other makers.

Success criteria: 10 makers, 5+ listings each, 3+ have made their first sale by end of month 1. The catalog crosses ~75 listings. Blog content writes itself from maker stories. From there, network effects start.

## Referral system (build later, in phases)

Do not build until there are 50+ active sellers (real referral potential).

**Phase 1 (when ready): Founding Maker referral pass.**
Each of the first 250 Founding Makers can grant one "Founding Maker referral pass" that fast-tracks a referee through the Guild Member criteria. Referee earns a "Founding Maker referred by #N" subtle badge on their profile. Caps gaming because each maker has exactly one pass.

**Phase 2: Fee discount for new sellers via referral code.**
New seller signs up with a referral code, gets 0% Grainline fee for first 3 months or first $500 of sales. Referring seller gets 1% reduction on their own fee for the same period. Gameable in theory (fake accounts) but defended by Stripe Connect verification + first-listing-required-for-payout. Net cost per real referral: $50-150. Net cost per fake referral: $0 (fakes never reach payout).

**Phase 3 (2027+): Percentage-of-sale referral.**
Referrer earns 1% of every sale the referee makes for 12 months, paid by Grainline (not deducted from referee). Powerful but expensive on P&L. Hold until margin allows.

**Explicitly skip:**
- Cash signing bonuses (gameable).
- Per-listing payouts (rewards stuffing the catalog with junk).
- Buyer-side referee discounts (wrong audience, won't move the needle at this stage).

## White-glove migration tool

A "paste Etsy URL" import flow. Public Etsy listing pages render server-side, so a simple fetch + parse can pull title, description, price, photos. Drew (or admin) pastes the URL, the tool drafts a Grainline listing with photos pre-uploaded to R2, seller reviews and edits, then publishes.

Build this only after 5 sellers are confirmed interested. Otherwise it's a feature without a market.

Tech notes:
- Etsy's robots.txt allows public listing page fetches.
- Photos need to be re-downloaded and uploaded to R2 (don't hot-link).
- Categorize via existing AI review pipeline.
- Mark as "Imported from Etsy" in admin notes for traceability.

## LLM-search positioning

### Current state (right move for next 12 months)
- robots.txt blocks GPTBot, ClaudeBot, CCBot, Google-Extended, anthropic-ai for training scraping. This is intentional and stays.
- llms.txt published at root for canonical-pitch consumption.
- Sitemap with rich Product / LocalBusiness / Article / Service JSON-LD. Already shipped.

### Revisit at ~500 listings
At catalog density, consider allowing AI bots for browse-tool / on-demand fetch (not training). The mechanism: keep the broad disallow but add specific allows for AI browse-tool user agents that respect non-training intent. OpenAI's `ChatGPT-User`, Anthropic's `Claude-User`, Google's `Google-Extended-User` (these are the live-browse agents, separate from training agents).

### Long term (3+ years)
LLMs will increasingly act as buyer intent resolvers. Marketplaces will compete to be the system the LLM calls via tool-use to fulfill an order. Grainline's existing Stripe Checkout API is already shaped correctly to be a backend for this. Direction: keep API endpoints clean and well-documented in case OpenAI Operator / Anthropic Computer Use / similar emerges as a buyer channel.

## Things explicitly NOT to do right now

- Don't run paid ads. CAC will be brutal at $0 GMV.
- Don't redesign. The product works. Ship sellers, not features.
- Don't add Canada. Terms already declines it. Revisit at $250K GMV.
- Don't build the percentage-of-sale referral. Margin trap.
- Don't add subscription tiers. Etsy did this. Sellers hate it.
- Don't build a mobile app. PWA is sufficient. Real mobile app is post-$1M ARR territory.
- Don't broaden scope to general handmade. The woodworking-only focus is the differentiator.

## Recurring observations on Etsy 10K (for refresh each year)

Etsy's recent annual reports surface the same pain points that Grainline is positioned against. Worth re-reading when each new 10K drops:

- GMS flat-to-declining since 2021. Documented "marketplace revitalization" theme in MD&A.
- Take rate creep, particularly through Offsite Ads expansion.
- Explicit risk-factor language about counterfeits and AI-generated content eroding buyer trust.
- AI search as a documented existential risk factor.
- Star Sellers + Etsy Plus + subscription monetization push (universally unpopular with sellers).

Each year's 10K refresh is free competitive intel. Pull the relevant quotes into recruiting copy.

## Geographic expansion plan

1. **Phase 1 (now through ~50 sellers):** Texas-first. Density story. Recruitment in r/Austin, r/Houston, r/Dallas, Texas Woodworkers Guild.
2. **Phase 2 (50 to 500 sellers):** Major US metros (NYC, Bay Area, Chicago, LA, PNW). City landing pages already exist as SEO surface area for this expansion.
3. **Phase 3 (500+ sellers):** Full national rollout.
4. **Canada (2027+):** Re-enable only after attorney review of Quebec Bill 96, PIPEDA cookie consent, GST/HST registration, and cross-border carrier considerations. Code change is one line in middleware; legal work is the bulk.

## When to revisit this file

- After every session that produces a strategic decision.
- Before any commit that changes scope, fee structure, or geography.
- When a referenced item ships (move from "to build" to a brief note that it shipped, then delete after 60 days).
