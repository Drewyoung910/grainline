# Deferred Launch Backlog

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
| RLS staging and first table policy | Conditional blocker | Live Neon-like pooling/context gate, route-level prototype tests, wrapper coverage guard, and first `Notification`/`SavedSearch` policy migrations. | Staging gate evidence passes with a retained sanitized JSON artifact from `RLS_CONTEXT_GATE_EVIDENCE_PATH`; first policy migration includes route tests, rollback notes, wrapper coverage, and CI; production RLS remains disabled until those pass. |
| Stripe refund runtime reconciliation | Launch blocker | Runtime/backfill proof beyond first-party orphan ledgers and local transfer-reversal evidence. | Test-mode refund scenarios produce matching Stripe refund, transfer reversal, `OrderPaymentEvent`, admin detail, and Sentry/audit evidence; any drift has a backfill or written reconciliation plan. |
| Stripe partial-refund reconciliation | Launch blocker | Live proof that partial connected-seller refunds reverse seller transfers correctly under the manual `transfer_data.amount` checkout model. | Stripe test-mode partial refund artifacts confirm buyer refund amount, transfer reversal amount/id, platform-funded remainder when relevant, and local ledger metadata. |
| Shipping label clawback reconciliation | Launch blocker | Runtime proof/dashboard reconciliation for Shippo label purchase plus Stripe transfer reversal retry/manual-review paths. | Test-mode label purchase covers successful reversal, missing transfer, reversal failure/retry, exhausted retry/manual review, and admin flagged-order visibility. |
| Stripe webhook subscriptions | Launch blocker | Dashboard evidence for snapshot and Connect v2 thin webhook endpoints and exact event subscriptions. | Screenshots or exported evidence show `/api/stripe/webhook` and `/api/stripe/webhook/v2` endpoints, separate secrets, and the exact event families in `docs/launch-checklist.md`. |
| Stripe Connect v2 loss-liability | Decision required | Ops/legal/accounting posture for Accounts v2 responsibility allocation and marketplace loss liability. | Counsel/accounting decision recorded in the legal risk register or launch records; any required product copy or operational control is implemented. |
| Stale remote branches | Post-launch hardening | Explicit review/prune of stale remote branches, especially old feature branches that should not be merged as-is. | Branch list reviewed; stale branches deleted or documented; any reusable diff is rebased/cherry-picked onto current `main` and re-audited. |
| Round 10 cache/state-machine designs | Decision required | Product designs that require behavior choices rather than more source guardrails. | Each remaining design is accepted, rejected, or converted into a concrete implementation issue with tests. |
| Runtime query plans | Post-launch hardening | EXPLAIN-dependent validation beyond current source indexes and query-shape guardrails. | Production-like seed/cardinality run records EXPLAIN plans for public discovery, seller pages, search suggestions, admin queues, and other high-traffic queries; indexes or query changes added if needed. |
| Provider-side privacy erasure | Launch blocker | Clerk/Stripe/Resend/R2/provider-held copy handling for account deletion and legal requests. | Live or staging privacy-request runbook evidence shows what is deleted, retained, retried, or manually requested from providers; legal retention exceptions are recorded. |
| Cross-seller AI duplicate detection | Decision required | Product/privacy design for AI duplicate-detection across sellers. | Decide whether to ship, defer, or remove the feature; if shipped, document data scope, retention, abuse handling, and owner-visible effects. |
| Durable checkout-group semantics | Decision required | Product semantics beyond current grouped ready-lock/reservation resume and completed-session filtering. | Decide whether one buyer-facing cart checkout should remain per-seller orders/receipts or gain a durable checkout-group model; implement before changing receipt/refund semantics. |
| High-scale BigInt and counters | Post-launch hardening | BigInt modeling for individual order/item cents fields and high-volume listing analytics counters beyond existing caps. | Traffic/revenue threshold chosen; migration plan or explicit deferral recorded; current caps remain tested. |
| Historical shipping-rate currency drift | Conditional blocker | Live-data reconciliation for historical seller shipping-rate currency drift. | Production data scan before launch with live historical data, or written not-applicable evidence if no affected production rows exist. |
| Clerk staff/security controls | Launch blocker | Staff/admin MFA, breached-password, multi-account/spam dashboard evidence. | Active Clerk plan settings captured; unavailable controls get documented exceptions; staff/admin MFA or enforcement plan is retained. |
| Buyer-deletion Stripe replay proof | Launch blocker | Live Stripe replay proof after source-side buyer deletion/minimization hardening. | Test-mode replay demonstrates deleted/suspended buyer checkout completions become blocked review orders with purged buyer PII and retained audit/review evidence. |
| Founding Maker concurrency | Conditional blocker | Live DB concurrency proof for Founding Maker permanence and cap behavior. | Staging/live-data transaction proof covers concurrent approvals and permanent badge rules before relying on the badge program at launch scale. |
| Sentry cron alerting | Launch blocker | Dashboard/runtime evidence for Sentry cron monitors and alert routing. | Every `vercel.json` cron has a monitor; ops-health warnings and failed/partial cron records route to alerts; evidence retained. |
| Cloudflare R2 posture and smoke | Launch blocker | ListBucket/public bucket posture plus production upload smoke/public-availability proof. | Dashboard/CLI evidence shows no public listing/ListBucket exposure; `npm run audit:r2-upload` passes with production-like credentials and a retained sanitized evidence artifact. |
| HSTS preload | Decision required | Actual preload submission/status, not just source-configured header. | Decide whether to submit `thegrainline.com`; if yes, record hstspreload.org pending/preloaded status; if no, record the legal/ops reason. |
| Vercel Analytics and Speed Insights | Decision required | Product/privacy decision before introducing Vercel telemetry. | Keep absent, or update privacy/product docs and tests before adding packages/components. |
| Homepage browser a11y/runtime proof | Launch blocker | Browser proof beyond static source guardrails. | Playwright or manual browser evidence covers desktop/mobile first viewport, reduced motion, keyboard nav, skip link, and no incoherent overlap. |
| Deployed security headers | Launch blocker | Runtime proof beyond `next.config.ts` and static tests. | `npm run audit:deployed-headers` passes against `https://thegrainline.com` with a retained sanitized artifact, and securityheaders.com, SSL Labs, and hstspreload.org evidence are retained separately. |

## Recommended Closure Order

1. Launch evidence and provider controls: Stripe webhooks, Clerk staff controls,
   Sentry cron alerts, R2 posture/smoke, deployed headers, homepage browser
   proof.
2. Money-movement runtime proof: refunds, partial refunds, label clawbacks,
   Connect v2 loss-liability, buyer-deletion Stripe replay.
3. Legal/product decisions: provider privacy erasure, HSTS preload, checkout
   grouping, cross-seller AI, Vercel telemetry.
4. Data/performance hardening: EXPLAIN plans, BigInt/counter modeling,
   historical shipping-rate currency scan, stale branch pruning.
5. RLS execution path: run the staging context gate, then migrate one table at a
   time with route tests and rollback evidence.
