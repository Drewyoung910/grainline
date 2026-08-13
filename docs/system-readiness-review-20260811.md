# Grainline System Readiness Review — 2026-08-11

Status: current architecture and product-readiness decision record. This review
changes no application, database, deployment, credential, or provider state.

## Why this review exists

The site-wide RLS program has correctly improved database authority one bounded
group at a time. RLS does not prove that the protected product workflow is the
right workflow, however. This checkpoint therefore reviews both the database
boundary and the product/state-machine logic around the completed Case group
and the active Order/payment/shipping group.

The review used exact main merge `944987f5d8f2ee6148c39c98001ce178362aa560`.
Main CI `31509843912` and the separate Notification FORCE PostgreSQL proof
`31509843969` both passed. PR `#194` changed no production state.

## Overall verdict

The architecture is headed in the right direction. The codebase is a large,
well-tested modular monolith rather than an unstructured application, and the
RLS design appropriately uses fixed operations for mixed-actor and service
tables instead of pretending that simple per-row policies can express every
checkout, webhook, refund, cron, and staff workflow.

Do not describe the application as perfect or fully launch-ready. Case database
authority is complete, but one Case product-policy mismatch and several
separately tracked launch operations remain. Order/payment/shipping has been
substantively audited, but most of that group is intentionally not RLS-live yet
and several historical-order/read conversions remain unfinished.

## Current production database boundary

- FORCE RLS is accepted for SavedSearch, Notification, Conversation, Message,
  DirectUpload, DirectUploadReference, Case, CaseMessage, and
  CaseMessageAttachment.
- StripeWebhookEvent is policyless Phase A: ENABLE is live, FORCE is not yet
  applied, and ordinary runtime/PUBLIC direct table and column authority is
  already zero.
- CheckoutStockReservation compatible authority is merged and proved only as a
  production-inert candidate. Its production migration runner remains
  intentionally unwired.
- Order, OrderItem, OrderShippingRateQuote, OrderPaymentEvent,
  SellerPayoutEvent, and CheckoutStockReservation are one audit program with
  separate production releases. The remaining group must not be collapsed into
  a single activation.

## Case system assessment

### What is genuinely complete and strong

- Case, CaseMessage, and CaseMessageAttachment are policyless ENABLE plus FORCE
  with zero direct ordinary-runtime/PUBLIC table or column authority.
- The fixed operations derive participant, staff, webhook, cron, refund, audit,
  and replay relationships from locked database facts rather than trusting
  caller-selected target rows.
- Case creation is one-per-Order, requires a paid eligible Order, derives the
  buyer and one seller, and serializes with conflicting Order transitions.
- Replies use stable author-kind snapshots, bounded bodies, parent locking,
  database time, replay protection, participant/staff status rules, and bounded
  50-row `(createdAt,id)` history pages.
- Seller response deadlines, participant escalation, stale discussion,
  participant resolution, staff resolution/refunds, Stripe dispute reopen,
  account export, account deletion, and Case predicates used by Order flows all
  have explicit fixed destinations and PostgreSQL proofs.
- Staff refund resolution uses a durable prepare/provider-record/finalize claim
  rather than holding a database transaction across Stripe. Ambiguous outcomes
  enter reconciliation instead of being reported as clean success.
- Buyer and seller notifications are both represented, and Case audit evidence
  is co-committed with the corresponding state transitions.

### Launch and product gaps that remain

1. **Private Case evidence is implemented but disabled.** The private model,
   bounded image processing, opaque DirectUpload relationship, participant/staff
   authorization, short-lived signed read, export/deletion behavior, and Case
   RLS boundary exist. `CASE_EVIDENCE_ATTACHMENTS_ENABLED` remains absent or
   `false` pending the private-R2 authenticated smoke, DirectUpload cleanup
   scheduling, cleanup-token retirement, and provider-variable release. Because
   the Terms say staff review photos, this is a launch requirement rather than
   optional polish. PDFs remain correctly prohibited until a malware
   scan/quarantine design exists.
2. **The resolution-window contract is inconsistent.** Either participant can
   move a Case to `PENDING_CLOSE`. The database cron auto-resolves any such Case
   as `DISMISSED` after seven days, including a seller-only resolution mark. The
   seller UI says "Both parties must confirm to close the case," the notification
   says confirm or continue the discussion, and the route comment says 48 hours.
   None describes the actual seven-day auto-dismissal. Before launch, choose and
   implement one explicit rule. Recommended buyer-protective rule: buyer-only
   marks may auto-dismiss after a disclosed window; seller-only marks must not
   silently dismiss the buyer's dispute and should remain open or escalate to
   staff. Any choice needs Terms/UI/copy, migration/function, race, notification,
   and cron-proof updates together.
3. **Staff assignment/SLA ownership and in-product appeals remain deliberate
   later work.** One staffed prelaunch queue can operate without assignment, and
   the contractual one-time re-review currently uses email. Add assignment/SLA
   when multiple staff share the queue; add an appeal record only with reviewed
   legal and retention semantics. Before launch, the manual staffing and email
   re-review process still need operational evidence because the Terms promise
   a 3–5 business-day review and a 14-day re-review response.
4. **`CLOSED` is a retained terminal enum state but is not part of the current
   ordinary lifecycle.** Current automatic and participant dismissals resolve
   to `RESOLVED`; the database only permits `RESOLVED -> CLOSED`. This is not a
   launch blocker, but the archival/retention trigger for using `CLOSED` should
   be documented before adding a caller that writes it.
5. **Cron observability is misleading.** The `case-auto-close` response field
   named `closed` also increments for rows escalated to `UNDER_REVIEW`. The
   family-specific counters are accurate, so state behavior is not affected,
   but the aggregate should be renamed or split before dashboards depend on it.

Case RLS should not be undone or redesigned because of these product gaps. The
fixed-operation boundary is compatible with correcting the Case policy in a
narrow later migration.

## Order, checkout, payment, refund, and shipping assessment

### What has already been checked and strengthened

- The audit inventories buyer, seller, staff, Stripe, Shippo, cron, analytics,
  account lifecycle, refund, dispute, label, and Case interactions rather than
  reviewing only public routes.
- Production aggregate inspection found zero structural/integrity anomalies in
  the accepted 54-count snapshot. That was classification evidence, not a
  permanent guarantee.
- New paid checkout writes durable seller profile IDs to Order and OrderItem;
  database triggers/composite keys reject mixed or caller-mismatched seller
  assignments.
- StripeWebhookEvent uses generation-bound begin/complete/fail operations,
  immutable event type/source binding, stale-worker rejection, and zero direct
  runtime table authority. Test-mode classic Connect `payout.failed` delivery
  and exact retry passed.
- CheckoutStockReservation's candidate replaces generic restore-by-ID behavior
  with source-specific cart, single, bind, completion, abort, signed expiry,
  seller/buyer expiry, repair, export, scrub, and prune operations. Provider
  repair uses generation fences; Redis publication uses unique owner tokens;
  post-Stripe failures restore stock only after confirmed session expiry.
- Refund, dispute, label, and checkout work already contain extensive
  idempotency, Order locks, reconciliation, bounded input, audit, and
  side-effect observability controls.

### What is not finished yet

1. **Most of the six-table Order group still has broad predecessor runtime CRUD
   and application-layer authorization.** This is the active reason to continue
   the rollout, not evidence that current normal web traffic is unauthenticated.
2. **Historical Order reads still depend on mutable live Listings.** Buyer,
   seller, and admin order pages currently render current listing titles,
   photos, seller display data, and some processing fields. Seller order
   authorization/listing still derives through the current Listing seller in
   several paths. Checkout already captures `listingSnapshot`, and new rows have
   durable seller keys, but those facts are not yet the primary read/authority
   source. This must be converted before Order RLS activation so catalog edits
   cannot rewrite history or transfer access.
3. **The durable seller keys remain nullable for old-deployment coexistence.** A
   fresh aggregate inspection and classified convergence must precede `NOT
   NULL`; no migration should invent a seller for an anomalous legacy Order.
4. **The complete Order fixed-operation catalog is still design/incremental
   work.** Fulfillment, labels/quotes, seller and staff refunds, payment and
   payout evidence, participant/staff projections, exports, deletion, and
   maintenance must reach zero unconverted ordinary-runtime base-table access
   before activation.
5. **Provider and money-movement launch evidence is separate from RLS.** Valid
   Connect v2 signed delivery and live-mode topology remain open, as do the
   retained refund/partial-refund and label-clawback reconciliation proofs.
6. **The Stripe webhook and account-deletion coordinators are large hotspots.**
   Preserve behavior during this RLS program; extract event handlers only after
   the sensitive-data boundary is stable, with state-machine and idempotency
   tests carried over unchanged.

## Documentation assessment

The repository records unusually strong evidence: exact commits, workflow
runs, migration hashes, failed proofs, rollback shape, postflights, threat-model
limits, and deliberate deferrals. The problem is not missing volume; it is
current-state discoverability.

- `docs/architecture.md`, `docs/rls-coverage-matrix.md`, and the top of
  `STRATEGY.md` are the current-state entry points.
- Many preparation/audit documents accurately describe an earlier checkpoint
  but still open with statements such as "RLS remains off" after the table is
  live. They must be labeled historical/superseded instead of rewritten as if
  their historical evidence occurred later.
- `CLAUDE.md`, `audit_open_findings.md`, and rollout plans are too large for a
  new engineer to treat as an index. Preserve them as detailed contracts and
  evidence, but route readers through concise current-state documents and
  focused domain decision records.
- `docs/deferred-launch-backlog.md` contained completed first-table RLS and old
  Stripe subscription state. The backlog must be refreshed whenever a provider
  or RLS boundary closes; otherwise a future maintainer cannot tell open work
  from historical evidence.

## Recommended path forward

1. Keep production unchanged while this review and its documentation correction
   are reviewed.
2. Resolve the Case seven-day auto-dismissal product contract and align database
   behavior, Terms, UI, notifications, tests, and cron evidence as one change.
3. Complete the separate private Case-evidence launch boundary and DirectUpload
   cleanup operations before claiming the Case product launch-complete.
4. Apply only the already reviewed StripeWebhookEvent FORCE release from an
   exact green main commit, then run the actual pooled-runtime read-only
   postflight.
5. Run a fresh aggregate-only CheckoutStockReservation production inspection.
   If it matches the reviewed predecessor, wire and apply only the compatible
   preparation, deploy/prove the dual-compatible application, drain old
   deployments, then activate ENABLE and FORCE separately.
6. Continue the remaining Order/OrderItem/quote/payment/payout operations,
   making durable seller keys and immutable checkout snapshots the read and
   authority source before table activation.
7. Close provider/live-money launch proofs independently. Do not weaken or
   reorder database authority merely because a provider proof is still open.

This preserves the careful rollout while correcting the false equivalence
between "RLS complete" and "product complete."
