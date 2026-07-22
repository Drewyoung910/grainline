# Grainline Strategy and Roadmap

Operational notes and strategic direction. AGENTS.md is the codebase contract (what is built, how it works, what must be preserved). This file is for what hasn't been built yet, why, and in what order. Update at the end of any session that produces strategic decisions.

## Immediate priorities

### SavedSearch Phase-B and runtime-separation completion (2026-07-21)

Bucket A is complete in production. Deployment
`dpl_6nVQx5HBmurzH9iU1vwQLjA6gy2N` promoted exact commit
`17bf93dc8837fd6c5e6988569f993781800b6318`; migration
`20260720060000_force_saved_search_rls` is complete, `SavedSearch` has exact
`ENABLE` plus `FORCE` and three policies, and the accepted private postflight has
SHA-256
`768096b53662ec9e8deaf8a3a63e6021ad755464f48b4b01c02fb339f1c78ea4`.

Runtime database credential separation is also complete. Production source
`b4f14beaff06831ed2e8d7a35578226b756c1a61` passed exact clean postflight
operator `8438ece93ff93572a015dd674f152c830cb5a52e`; the canonical record is
`docs/runtime-db-credential-separation.md`. Production Functions retain only
the constrained `grainline_app_runtime`; the rotated `NOSUPERUSER BYPASSRLS`
owner remains outside Vercel. This closes the prerequisite for isolated
Notification implementation, ephemeral PostgreSQL proof, and isolated
provider-candidate comparison. It does not authorize a Notification merge,
production apply/deployment, persistent staging activation, or RLS activation.

### Site-wide RLS expansion decision (2026-07-19)

SavedSearch is the first production RLS pattern, not the final scope. Its Phase-B
FORCE release and runtime credential separation are complete. Continue expanding
RLS across user-owned and sensitive data
in the reviewed sequence documented in the RLS feasibility and defense-in-depth
plans, with priority on notifications, carts, conversations and messages,
orders and payment/shipping records, and cases. Each table or tightly coupled
table group requires its own actor/read/write/cleanup inventory,
service/admin/cron/webhook design, staging proof, phased production activation,
rollback proof, and monitoring. Do not enable broad RLS mechanically or copy the
SavedSearch policy/RPC pattern onto tables with asymmetric, participant,
aggregate, public-read, or system-write behavior. Application authorization
remains primary; RLS is required defense in depth for the eventual sensitive
data posture.

Treat this as one site-wide sensitive-data RLS program for planning and status,
but not as one migration or production activation. Preserve the established
meaning of Bucket B as `Notification` so historical rollout evidence stays
unambiguous. Prepare shared inventories and infrastructure across later tables
where useful, then activate independently reviewed, tightly coupled groups:
`Notification`; `Cart` + `CartItem`; `SavedBlogPost`; aggregate/fanout tables;
`Conversation` + `Message`; the order/payment/shipping group; and `Case` +
`CaseMessage`. Each group must be independently deployable, observable, and
reversible before the next group begins. Never combine notification fanout,
messaging, checkout/payment, fulfillment, and dispute policy activation into a
single release.

This program scope is approved, not a menu to narrow silently. Every sensitive
or user-owned table discovered by the coverage inventory must end in one of
three explicit states: production RLS with retained proof; a reviewed database
isolation alternative with rationale; or a named, blocking deferral with owner
and prerequisites. Public catalog data, cross-user aggregates, and internal
service ledgers still require review and may need different database controls;
do not force an owner-policy shape where it is incorrect. Maintain the
schema-complete [`docs/rls-coverage-matrix.md`](docs/rls-coverage-matrix.md)
and never claim that all user data is protected by RLS until every table has an
evidenced disposition.

### Prelaunch RLS rollout proportionality (2026-07-22)

The confirmed prelaunch/no-dependent-users state permits shorter operating
windows, not weaker policy or compatibility proof. Do not impose a fixed
12-hour drain or repeat an unrelated provider benchmark solely for ceremony
when there are no customer requests to drain. Before compressing a wait,
reconfirm that no customer traffic, webhook, cron, queue, or administrator flow
can still use the superseded shape. Preserve the evidence explaining why the
shorter window was safe.

Keep the controls that catch correctness and release-shape defects even before
launch: ephemeral PostgreSQL authority/direct-denial/race proof; exact grants
and function ACLs; legacy-data inspection and backup before destructive
cleanup; atomic purge/backfill decisions; old/new application and database
compatibility; authenticated route smoke; and database-first rollback
semantics. Use separate preparation and activation migrations whenever an old
application build cannot safely coexist with the narrowed grants or new policy
surface. The absence of users does not stop Vercel build overlap, cron, or
webhook execution by itself.

Provider performance/locality proof is risk-triggered after Bucket B rather
than automatic for every table. Require it for a new hot path, interactive
transaction or pooling design, lock/concurrency behavior, cross-region change,
or material source-validation joins. Ordinary direct-owner tables may rely on
ephemeral PostgreSQL plus authenticated application smoke when review shows no
new provider/runtime performance question. Notification still requires a fresh
successful provider run because its real one-statement recipient RPC and
source-validation workload have not yet completed once in Vercel. Continue to
activate Notification, messaging, orders/payment/shipping, and cases as
separate tightly coupled groups; prelaunch is not permission to combine their
authority boundaries into one release.

### Runtime owner-credential separation result (updated 2026-07-21)

The release is complete and accepted in production; retain the exact contract,
failed-attempt history, evidence hashes, rollback posture, and operator rules in
`docs/runtime-db-credential-separation.md`. Vercel application builds must never
run owner migrations or receive an owner/admin database variable. Production
migrations run only from the manually approved, main-only GitHub `Production`
environment, and automatic Vercel production deployment from `main` remains off
so migrations and application promotion cannot race. The owner credential lives
only in that protected environment and ignored mode-0600
`.env.migration-owner.local`; `.env.local` is runtime-only. Any ambiguous future
control-plane reset must use reveal-based recovery and must never blindly issue
a second reset. Do not weaken the production-equivalent `LOGIN NOINHERIT`
runtime role fixture or the Vercel privileged-variable guard.

### Bucket B Notification design decision (2026-07-19)

Bucket B preparation has begun on an isolated, unmerged branch in
`docs/rls-bucket-b-notification-plan.md`; no policy is production-active. The
verified surface has simple recipient reads/mark-read operations but asymmetric
cross-user creation, dedup recovery, global retention, staff source cleanup,
and account-deletion cleanup. Use recipient SELECT/RLS plus
column-level `UPDATE (read)`, with no direct runtime INSERT/DELETE. Cross-user
creation and cleanup require separate fixed-purpose owner-backed RPCs; never
put a second owner/service credential into Vercel. The guarded prelaunch
Notification inspection, atomic activation-time purge, PostgreSQL proof, and
two fresh real-table Notification passes under the reviewed candidate-aligned
provider/route gate block activation. The unchanged transaction-wrapper limits
remain blocking for any later release that actually uses that architecture.
Activation remains separate ENABLE/NO FORCE and later FORCE releases after
Phase B and runtime credential separation are live.

The isolated branch contains both recipient candidates. Fixed
`SECURITY INVOKER` recipient RPCs cover bell, page, unread count, mark-one,
mark-many, conversation mark-read, export, and recent low-stock lookup in one
database round trip per application operation; the prior interactive-transaction
bell/page wrapper is retained only in Git/evidence history after its executable
candidate file was removed. The
2026-07-22 provider attempt selected the one-statement RPC direction: its
target/burst candidate comparisons passed with zero request or isolation errors,
while the generic wrapper crossed seven unchanged 2x adoption/hold thresholds.
The run consumed slot 1 and failed the existing generic gate, so it is not
promotion evidence and slot 2 was not called. Do not weaken the thresholds or
rerun for a favorable boundary sample. Before a fresh provider proof, review a
candidate-aligned gate that keeps wrapper limits blocking for releases that use
interactive transactions and requires two fresh real Notification RPC/route
passes for this release. The invoker draft now has disposable PostgreSQL
parse/apply, own/foreign/direct-denial, and context-reset proof; final SQL
authority review, real-table route proof, and authenticated runtime-credential
evidence remain open. Cross-user
creation and cleanup use separate service authority and must not be conflated
with recipient RPCs.

The later real-table provider attempt at commit
`aef7ef2686a0432529a2d17291e2ca04b2fa0714` is failed, consumed evidence too.
Its deployment and exact isolated runtime/database attestation passed, but slot
1 returned HTTP 500 immediately after durable claim because the candidate gate
used invalid `pg_catalog.current_user` SQL. Slot 2 was not called; all provider
resources were abort-cleaned; production was unchanged. `CURRENT_USER` and the
opaque Vercel environment-id validator now have regressions, but no successful
real Notification workload was produced. A fresh provider run remains required
before activation; do not reinterpret the infrastructure attestation as a
runtime pass.

The fresh follow-up at commit
`b295116a27401433e717e5022238c4006fb871c6` also failed after durable slot-1
claim and was not replayed. Its independent deployment attestation passed, but
the real source baseline used invalid `pg_catalog.exists(...)` syntax. The
correct `EXISTS (...)` expression is now guarded, all disposable resources were
again removed, and production remained unchanged. Before another provider
deployment, a reduced real-query local preflight must complete against fresh
fixtures and owner-reset/reseed them; environment configuration is mechanically
blocked until that preflight is recorded. A later successful local diagnostic
does not retroactively accept either consumed Vercel slot.

A third predeployment-only attempt consumed no Vercel slot: its mandatory local
preflight exited before JSON. A direct invocation later reproduced the exact
pre-main defect: unsupported top-level `await` in the standalone TSX CommonJS
output. The attempt was fully abort-cleaned with production unchanged. The
script now uses a CommonJS-compatible invocation with a regression, and the
operator directly invokes a package-metadata-verified, pinned local TSX
`4.21.0` binary instead of relying on `npm exec`; a fresh database/preflight
remains required.

The fourth attempt passed the mandatory local preflight and provider slot 1,
then failed slot 2 only on the fixed per-slot 2x bell p95 ratio. Correctness and
all request error counts remained green. The reversed slots exposed a symmetric
first-measured-workload ramp (`149.1ms` first baseline in slot 1; `147.2ms`
first candidate in slot 2) while the later workloads were `26.8ms` and
`22.9ms`. Do not retroactively accept the failed gate. The harness now primes
each side at full measured concurrency immediately before measurement and must
pass a fresh two-slot proof. The failed environment was fully removed and
production remained unchanged.

The fifth fresh attempt validated the priming correction and completed the
Notification provider gate. Its local preflight and both non-replayable,
order-reversed Vercel slots passed exact correctness, zero errors, the fixed 2x
ratio, and the 250ms candidate ceiling without exception. The bell target,
burst, and service p95s stayed between `21.7ms` and `39.9ms` across both slots.
Success cleanup removed every disposable resource and production remained
unchanged. Treat provider performance/locality as complete for this exact
Notification design; authenticated route smoke, the final Extra High authority
review, activation packaging, and production evidence remain open.

The isolated service-authority draft now uses seventeen owner-backed functions:
one runtime-ungranted fixed-column core, ten granted creation families, one
dedicated back-in-stock claim/create/consume operation, three exact cleanup
operations, and two fixed retention batches. Runtime receives exact execute
privileges only on the sixteen fixed-purpose entry points;
direct Notification insert/delete and the default public function privilege
remain revoked. The application paths are wired to the draft and broad legacy
Notification cleanup fallbacks have been removed from runtime code. Because the
site remains prelaunch with no users relying on notifications, a guarded
owner-only operator may inspect legacy aggregate counts. The purge must be the
first locked step inside the same transaction that activates Notification RLS;
a standalone reset would leave a recreation race. If the no-users premise
changes, the purge is
prohibited and a backfill must be designed. Application-asserted `app.user_id` is
not database-authenticated identity and a compromised runtime can forge it;
fixed-purpose constraints limit that residual without eliminating it.
In addition, most durable source/audit tables remain ordinary runtime-CRUD
tables until their later independent RLS or database-isolation groups. A fully
compromised runtime may therefore fabricate upstream evidence before invoking a
narrow Notification wrapper. Bucket B still removes direct arbitrary
Notification writes and caller-controlled payload/target identity, but it is
not a complete arbitrary-runtime-compromise boundary on its own. Close that
dependency through the site-wide program; do not activate orders, messages,
cases, and audit ledgers in the same Notification release merely to make a
broader claim.

The existing site-wide runtime-role tooling is part of the Bucket B security
boundary, not a later cleanup. It now runs provisioning mutations
transactionally, aborts on partial Notification RLS state, and converges an
activated Notification table back to `SELECT` plus column-only `UPDATE(read)`.
It also converges all 25 Notification RPC ACLs while keeping the private create
core runtime-ungranted. The grant audit derives FORCE expectations from ordered
migration history and checks the exact Notification policies, column grants,
function owner/mode/search path/overload shape, PUBLIC revokes, and runtime
execute split. The release topology is explicitly split: a preparation
migration installs the schema/RPC surface while retaining disabled RLS, zero
policies, and legacy table CRUD; the RPC application deploys and is verified;
only then may a locked activation migration purge pre-authority rows, install
the policies, enable initial `NO FORCE`, and narrow table grants. Keep three
evidence layers distinct:
the AST gate covers all 54 application emission paths; disposable PostgreSQL
run `29893071538` at exact source
`187ac2fa5a5b7c08a3889b27ef57c873ee7a79ea` executes all 26 family-dispatched
private-core source-validation branches plus the dedicated back-in-stock claim
with valid creation, stable replay, and forged-recipient or mismatched-evidence
rejection. Its 59 creation cases cover all 38 successful source/type pairs and
the security-relevant action, status, and recipient-direction variants within
those source types. The accepted run also proves post-draft role
provisioning reconvergence and the catalog proof on fresh PostgreSQL 16. The
generic grant audit's Notification migration-inventory branch is now exercised
by the later split-migration proof described in the Bucket B operating record;
do not retroactively count the earlier draft run as that proof.

Extra-high review accepts the current source-derived shared create function and
split migration topology for continued proof, not production activation. The
54/54 callsite result and 59-case live result validate the architecture, the
granted boundary, every top-level private-core source branch, every successful
source/type pair, and the security-relevant action/recipient variants.
The latest isolated PostgreSQL proof is green and also passes catalog/grant,
direct-denial, recipient context reset, service replay, the one-shot stock
claim, and both two-session block-race checks. The byte-pinned split migration
and database-first rollback have passed disposable PostgreSQL proof. Provider
route/authentication and application-deployment rollback evidence remain
separate. This narrows the remaining work; it does
not by itself select the recipient architecture, replace provider/performance
proof, prove the production authentication path, authorize merge, or activate
any persistent database. The later 2026-07-22 provider result above selects the
RPC direction without converting either proof into activation evidence.
Do not deploy the long-lived Notification branch for the remaining real-table
provider proof. Its unapplied SQL drafts deliberately make every
Vercel build fail closed, and automatic deployment is disabled for that exact
branch. Use a freshly reviewed disposable proof branch with only the exact
candidate and temporary Preview runner artifacts needed for the next proof.
The runner branch and all branch-scoped provider credentials/resources must be
deleted after sanitized evidence and teardown proof are retained; the generic
harness, regression tests, and operating record remain durable.
The granted wrappers no longer accept notification title, body, link, or dedup
identity. The private core derives all four inside owner authority from the
validated recipient, type, source row, related actor, and source-specific
columns. App-level title/body copies are non-authoritative compatibility
evidence; link and dedup scope are telemetry only. Social/content/message/commission
absence-of-block checks now share a deterministic lock protocol with every
ordinary block/unblock writer: notification creation takes sorted-pair
`FOR SHARE`, while block mutation takes sorted-pair `FOR UPDATE`. Account
deletion retains its earlier conflicting lifecycle lock before block cleanup.
The owner core rejects isolation other than `READ COMMITTED`, and ordinary
block mutations request it explicitly, so a stale transaction snapshot cannot
silently weaken the absence check. This is statically guarded but still needs
two-session PostgreSQL race proof.
Retain provider performance proof for the source-validation joins.

The message family uses `Message.id` as its durable source. For custom-order
ready links, the private core extracts the listing id from the structured
message, checks the reserved buyer, seller, conversation and listing status,
and derives the canonical route. It is not stored as a second
Notification source field.

The inventory family is complete in the isolated draft. Checkout low-stock binds the
exact order item to a paid order, completed stock reservation, listing owner and
current low-stock state, then derives payload, route and replay identity inside
owner authority. Manual low-stock now writes durable audit evidence atomically
with the row-locked listing update and derives its payload, route and identity
from that event. Back-in-stock writes durable restock-transition evidence with
the stock mutation, then atomically validates that audit and the locked
subscription, creates the preference-gated Notification, consumes the one-shot
subscription, and exposes only the winning claim to email fanout.

The verification/Guild family now binds seven staff transitions to the exact
durable, non-undone AdminAuditLog row co-committed with the state change and binds three
cron transitions to fixed-job SystemAuditLog evidence. The first metrics warning
was moved into an audited transaction; the owner wrapper derives payload and
route only after validating actor, recipient, verification status, and Guild
level.

The listing-moderation and account-warning families are also complete in the
isolated draft. Listing approval/rejection returns the exact staff audit written
with the transition; listing reports use the durable `UserReport`. A successful
admin email writes bounded notification content into a strict post-send audit
before attempting the in-app row. Banned-seller buyer warnings use a compound
ban-audit/order event, validate that the order is listed in the ban snapshot,
and retain the banned seller as exact related-user lifecycle metadata.

The order/payment/fulfillment family completes creation coverage. Checkout
buyer/seller notifications bind the atomic checkout-order audit; three seller
fulfillment transitions co-commit a user-attributed system audit; seller and
blocked-checkout refunds plus Stripe disputes bind `OrderPaymentEvent`; payout
failure binds `SellerPayoutEvent`. The owner wrapper derives the recipient,
counterparty, payload, route, and replay identity from those ledgers and exact
order relationships.

Production activation also has a permanent completeness gate:
`npm run audit:rls-notification-readiness`. It inventories the real TypeScript
emission paths, requires the exact 54-path contract, and fails on dynamic calls,
missing source pairs, or source constants that do not dispatch through a
reviewed service family whose draft SQL function, `PUBLIC` execute revoke, and
runtime grant are present. Its current 54/54 result passes the
creation-authority gate; ordinary tests retain the exact count and authority
surface tripwires so new or dynamic paths cannot disappear silently. This green
gate is only one activation prerequisite.

Use a hybrid rather than either extreme. Do not grant runtime the current
generic arbitrary-type/arbitrary-recipient creator, and do not collapse the
completed paths into identical lifecycle metadata. Keep the
fixed-column insert primitive private to the function owner and expose only
family-specific operations keyed by stable domain ids and small event
discriminators. The ten-family inventory and implementation order live in
`docs/notification-create-authority-inventory.md`. This preserves meaningful
write-side defense in depth while keeping database validation proportional to
what each application, staff, cron, or provider flow can actually prove.

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
