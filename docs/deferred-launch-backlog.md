# Deferred Launch Backlog

Last current-state refresh: 2026-08-11. Use
`docs/system-readiness-review-20260811.md` for the product-plus-RLS review that
produced this refresh.

This tracker turns the audit ledger's deferred count into executable launch
work. As of audit_closed Entry 517, the ledger has 87 deferred
product/design/ops/legal findings and 0 unvetted raw allegations. The 87 count
is per-finding accounting; the table below groups those findings into the
cohesive sections we should finish one at a time.

`docs/launch-checklist.md` remains the canonical master checklist for official
launch readiness. This file owns the audit-deferred backlog only; launch legal,
vendor, deploy, smoke-test, SEO, and business gates still live in the launch
checklist unless a row below explicitly links to them.

Deferred does not mean ignored. A deferred item must have a closure artifact:
source fix plus tests, runtime evidence, dashboard screenshots, legal/product
decision, or a written non-launch acceptance decision. If a deferred item proves
to be a source defect during execution, fix it and add focused tests instead of
leaving it in this file.

## Working Rules

- Finish one cohesive section before opening a broad new security/audit slice,
  unless CI is red, Drew redirects the work, or a blocker in that section needs
  external evidence.
- Do not add a new deferred category without adding or updating a row here with
  closure criteria.
- Keep launch blockers separate from post-launch hardening. If we intentionally
  launch with a non-blocker open, record the decision and the reason.
- Claude/Fable/agents may propose evidence gaps, but Codex must verify the
  current repo state and own any source changes or closure claims.
- Before calling the launch evidence backlog complete, run the launch evidence inventory
  (`npm run audit:launch-evidence`) against the retained artifact bundle and
  manual evidence manifest.

## Status Labels

- `Launch blocker`: close before accepting live marketplace transactions.
- `Conditional blocker`: close before enabling the named feature, provider
  mode, or RLS table policy.
- `Decision required`: Drew, legal, accounting, or ops must choose and record a
  posture before closure.
- `Post-launch hardening`: not a current launch blocker under existing caps and
  disabled features, but should stay tracked.

## Current Grouped Backlog

| Section | Status | What is deferred | Closure criteria |
| --- | --- | --- | --- |
| Order/payment/shipping RLS continuation | Conditional blocker | SavedSearch, Notification, Conversation/Message, DirectUpload and Case-family production boundaries are complete. StripeWebhookEvent is policyless Phase A with FORCE prepared but unapplied. CheckoutStockReservation compatible authority is merged but production-inert; the remaining Order-family tables still use predecessor direct authority. | Apply and postflight only the reviewed StripeWebhookEvent FORCE release; rerun the aggregate reservation inspection; then complete compatible preparation, app/drain proof, ENABLE and FORCE as separate reservation releases. Convert the remaining Order/OrderItem/quote/payment/payout projections and mutations to immutable checkout facts and fixed operations before their activations. |
| Private Case evidence release | Launch blocker | The private CaseMessageAttachment/DirectUpload model and Case RLS boundary exist, but `CASE_EVIDENCE_ATTACHMENTS_ENABLED` remains absent or false. Terms say staff review photos. | Pass the private-R2 authenticated upload/read/foreign-denial smoke, schedule and prove the restricted DirectUpload cleanup worker, retire temporary cleanup credentials/tokens, promote the exact feature flag, and retain launch evidence. PDFs remain disabled until malware scanning/quarantine is reviewed. |
| Case resolution-window contract | Decision required | Any participant may mark a Case `PENDING_CLOSE`; current cron auto-dismisses every such Case after seven days, including seller-only marks, while UI says both parties must confirm and a route comment says 48 hours. | Choose one disclosed rule and align fixed database transition, cron proof, Terms, UI, notification copy and tests. Recommended: a seller-only mark cannot silently dismiss the buyer's Case; leave it open or escalate it after the window. |
| DirectUpload cleanup operations | Launch blocker | DirectUpload FORCE and cleanup-role proofs are accepted, but the dedicated cleanup schedule, first successful run, failure alerting and final token/credential retirement remain separate operations. | Enable only the reviewed restricted worker, prove a scheduled pass and alert path, confirm no cleanup DB URL exists in Vercel, rotate/retire temporary cleanup credentials, and retain sanitized evidence. |
| Stripe refund runtime reconciliation | Launch blocker | Runtime/backfill proof beyond first-party orphan ledgers and local transfer-reversal evidence. | Test-mode refund scenarios produce matching Stripe refund, transfer reversal, `OrderPaymentEvent`, admin detail, and Sentry/audit evidence; any drift has a backfill or written reconciliation plan. |
| Stripe partial-refund reconciliation | Launch blocker | Live proof that partial connected-seller refunds reverse seller transfers correctly under the manual `transfer_data.amount` checkout model. | Stripe test-mode partial refund artifacts confirm buyer refund amount, transfer reversal amount/id, platform-funded remainder when relevant, and local ledger metadata. |
| Shipping label clawback reconciliation | Launch blocker | Runtime proof/dashboard reconciliation for Shippo label purchase plus Stripe transfer reversal retry/manual-review paths. | Test-mode label purchase covers successful reversal, missing transfer, reversal failure/retry, exhausted retry/manual review, and admin flagged-order visibility. |
| Stripe webhook launch topology | Launch blocker | The corrected three-surface test-mode topology is live and the classic Connect `payout.failed` signed-delivery plus exact-retry proof passed. Connect v2 signed delivery and the separately controlled live-mode topology/secrets remain unproved launch boundaries. | Retain a passing read-only `npm run audit:stripe-webhooks` topology artifact, valid Connect v2 signed delivery, exact live-mode source/event sets, separate signing-secret matching evidence for all three destinations, and a reviewed live-money cutover/rollback record. Do not reopen the accepted StripeWebhookEvent database boundary to satisfy provider evidence. |
| Stripe Connect v2 loss-liability | Decision required | Ops/legal/accounting posture for Accounts v2 responsibility allocation and marketplace loss liability. | Counsel/accounting decision recorded in the legal risk register or launch records; any required product copy or operational control is implemented. |
| Stale remote branches | Post-launch hardening | Explicit review/prune of stale remote branches, especially old feature branches that should not be merged as-is. | Branch list reviewed; stale branches deleted or documented; any reusable diff is rebased/cherry-picked onto current `main` and re-audited. |
| Round 10 cache/state-machine designs | Decision required | Product designs that require behavior choices rather than more source guardrails. | Each remaining design is accepted, rejected, or converted into a concrete implementation issue with tests. |
| Runtime query plans | Post-launch hardening | EXPLAIN-dependent validation beyond current source indexes and query-shape guardrails. | Production-like seed/cardinality run records EXPLAIN plans for public discovery, seller pages, search suggestions, admin queues, and other high-traffic queries; indexes or query changes added if needed. |
| Provider-side privacy erasure | Launch blocker | Clerk/Stripe/Resend/R2/provider-held copy handling for account deletion and legal requests. | Live or staging privacy-request runbook evidence shows what is deleted, retained, retried, or manually requested from providers; legal retention exceptions are recorded. |
| Cross-seller AI duplicate detection | Decision required | Product/privacy design for AI duplicate-detection across sellers. | Decide whether to ship, defer, or remove the feature; if shipped, document data scope, retention, abuse handling, and owner-visible effects. |
| Durable checkout-group semantics | Decision required | Product semantics beyond current grouped ready-lock/reservation resume and completed-session filtering. | Decide whether one buyer-facing cart checkout should remain per-seller orders/receipts or gain a durable checkout-group model; implement before changing receipt/refund semantics. |
| High-scale BigInt and counters | Post-launch hardening | BigInt modeling for individual order/item cents fields and high-volume listing analytics counters beyond existing caps. | Traffic/revenue threshold chosen; migration plan or explicit deferral recorded; current caps remain tested. |
| Historical shipping-rate currency drift | Conditional blocker | Live-data reconciliation for historical seller shipping-rate currency drift. | `npm run audit:shipping-currency` passes against production data with a retained sanitized artifact, or written not-applicable evidence is retained if no historical seller/listing/order data exists before launch. |
| Clerk staff/security controls | Launch blocker | Staff/admin MFA, breached-password, multi-account/spam dashboard evidence. | Active Clerk plan settings captured; unavailable controls get documented exceptions; staff/admin MFA or enforcement plan is retained. |
| Buyer-deletion Stripe replay proof | Launch blocker | Live Stripe replay proof after source-side buyer deletion/minimization hardening. | `npm run audit:buyer-deletion-replay` passes after a real Stripe test-mode checkout completion/replay whose source buyer was deleted, suspended, or missing before webhook processing; the retained sanitized artifact verifies blocked review state, purged buyer PII fields, exact Stripe-bound event through the rollback-only fixed lease, automatic refund ledger, and audit evidence without direct webhook-table SELECT. |
| Founding Maker concurrency | Conditional blocker | Live DB concurrency proof for Founding Maker permanence and cap behavior. | `npm run audit:founding-maker` passes against a staging/local database with production migrations applied and a retained sanitized artifact covers concurrent approvals, durable grant-ledger non-reuse after synthetic hard delete, cap fail-closed behavior, and cleanup. Do not run this proof against production because it creates and deletes synthetic rows. |
| Sentry cron alerting | Launch blocker | Provider/runtime evidence for Sentry cron monitors and alert routing. | `npm run audit:sentry-crons` passes with live read-only Sentry credentials and a retained sanitized artifact showing every `vercel.json` cron has a matching monitor plus alert-routing configuration for `cron_ops_health`, `AccountDeletionSideEffect`, direct-upload cleanup, webhook failure spikes, and CSP; dashboard screenshots or exported evidence show actual notification delivery/routing. |
| Cloudflare R2 posture and smoke | Launch blocker | ListBucket/public bucket posture plus production upload smoke/public-availability proof. | Dashboard/CLI evidence shows no public listing/ListBucket exposure; `npm run audit:r2-upload` passes with production-like credentials and a retained sanitized evidence artifact. |
| HSTS preload | Decision required | Actual preload submission/status, not just source-configured header. | Decide whether to submit `thegrainline.com`; if yes, record hstspreload.org pending/preloaded status; if no, record the legal/ops reason. |
| Vercel Analytics and Speed Insights | Decision required | Product/privacy decision before introducing Vercel telemetry. | Keep absent, or update privacy/product docs and tests before adding packages/components. |
| Homepage browser a11y/runtime proof | Launch blocker | Browser proof beyond static source guardrails. | Playwright or manual browser evidence covers desktop/mobile first viewport, reduced motion, keyboard nav, skip link, and no incoherent overlap. |
| Deployed security headers | Launch blocker | Runtime proof beyond `next.config.ts` and static tests. | `npm run audit:deployed-headers` passes against `https://thegrainline.com` with a retained sanitized artifact, and securityheaders.com, SSL Labs, and hstspreload.org evidence are retained separately. |
| Node runtime major alignment | Conditional blocker | `package.json` permits `>=22`, so Vercel can build with Node 24 while GitHub CI uses Node 22. Security tests are broad, but automatic major drift makes production/CI parity non-deterministic. | Pin one supported Node major, run complete CI and production build on it, align Vercel and GitHub settings, and document the upgrade policy before launch. |

## Recommended Closure Order

1. Correct the Case resolution-window contract, then finish private Case
   evidence and DirectUpload cleanup operations.
2. Launch evidence and provider controls: Stripe webhooks, Clerk staff controls,
   Sentry cron alerts, R2 posture/smoke, deployed headers, Node runtime parity,
   and homepage browser proof.
3. Money-movement runtime proof: refunds, partial refunds, label clawbacks,
   Connect v2 loss-liability, buyer-deletion Stripe replay.
4. Legal/product decisions: provider privacy erasure, HSTS preload, checkout
   grouping, cross-seller AI, Vercel telemetry.
5. Data/performance hardening: EXPLAIN plans, BigInt/counter modeling,
   historical shipping-rate currency scan, stale branch pruning.
6. RLS execution path: complete StripeWebhookEvent FORCE, then continue
   CheckoutStockReservation and the remaining Order/payment/shipping tables one
   reviewed boundary at a time with exact proofs and rollback evidence.
