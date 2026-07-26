# Case and CaseMessage RLS Plan

Opened 2026-07-26. Current phase: Phase 1B compatible integrity work.
Production Case/CaseMessage RLS remains off.

The behavior findings and 69-reference source baseline live in
`docs/case-case-message-pre-rls-audit.md`. This document controls sequencing.
It contains no approved policy or function SQL.

## Scope boundary

Case and CaseMessage may activate together because child visibility and write
authority depend on the parent. They must not activate with Order,
OrderItem, payment events, shipping quotes, SellerProfile, Notification or
audit tables.

Fixed Case operations may validate those durable source tables. That does not
move the source table into this activation or authorize broad writes to it.
The missing seller decision notice reuses the existing live, already-proven
staff-`CaseMessage` Notification source family. No Notification function,
policy, or grant change is needed.

The older feasibility sequence placed Case after Order because of these joins.
The current program deliberately audits Case first: it is a narrower private
dispute boundary, Conversation/Message is complete, and owner-backed fixed
Case functions can validate an unprotected Order without requiring Order RLS.
Order/payment/shipping still receives its own later audit and release.

The Case private-object review exposed a separate, already-live messaging
storage boundary: ordinary Message rows and attachment references are protected
by FORCE RLS, but their current R2 objects use public bearer URLs. This is
recorded as CM-A20 in `docs/conversation-message-pre-rls-audit.md`. It does not
change the accepted Conversation/Message database catalog or move ordinary
Message into the Case activation. Finish the current Case lifecycle proof
checkpoint, then give ordinary-message private-object compatibility and legacy
classification their own reviewed pass before Case policy activation. Shared
private-bucket primitives may be reused, but authority routes, object prefixes,
legacy handling and proof evidence remain separately scoped.

## Phase 0: audit checkpoint at High

- Pin all direct Prisma, nested relation and raw SQL references.
- Confirm application actor checks, cross-origin guards, rate limits and
  current state transitions.
- Record integrity, lifecycle, concurrency, retention/export and scale gaps.
- Correct stale architecture, strategy and coverage records.
- Make no production, database, provider or policy change.

Exit: the audit baseline is committed, tests pass, and every open defect has a
specific pre-policy disposition.

## Phase 1A: compatible product work at High

This phase remains compatible with the current broad runtime grants and RLS-off
tables.

1. Add stable `(caseId, createdAt, id)` history order/index and bounded older
   history for buyer, seller and staff. Keep the separate account export
   complete through its dedicated participant projection rather than
   truncating legal export data.
2. Align the scheduled non-response transition with the chosen 48-hour public
   contract.
3. Carry the accepted private processed-photo Case evidence requirement into
   the reviewed compatible schema design. Keep PDFs out until malware scanning
   and quarantine are designed.

Exit: focused product tests, TypeScript, lint and the full unit suite are green.
No RLS behavior has changed.

## Extra-High switch boundary

Switch back to Extra High before Phase 1B. These are load-bearing database
integrity, transaction-locking and already-live Notification authority changes,
even though Case/CaseMessage RLS remains off. Stay on Extra High through the
authority catalog and PostgreSQL proof.

## Phase 1B: compatible integrity work at Extra High

1. Add durable CaseMessage author kind and render it instead of mutable current
   User role.
2. Add the exact `(caseId, createdAt, id)` history index and the private-object
   `CaseMessageAttachment` image model with parent visibility, verified upload
   ownership, authenticated retrieval, export, deletion and retention
   behavior. Do not persist a public evidence URL.
3. Deliver staff Case decisions to the seller with source-derived seller copy
   through the existing fixed Notification boundary. Implemented on the
   isolated branch: resolution creates a fixed-copy staff `CaseMessage` and
   `AdminAuditLog` in the same transaction as the Case transition, then the
   existing case-message family validates and derives the seller notification.
   The permanent Notification callsite gate intentionally moved from 54/54 to
   55/55.
4. Make Case creation, participant escalation and staff resolution audit
   evidence atomic with the database state transition. Implemented on the
   isolated branch with strict transactional human-audit writes; a failed audit
   rolls the local transition back, while existing Stripe orphan handling still
   records provider-side refunds that crossed the database boundary.
5. Establish the shared Order-lock protocol for Case creation and conflicting
   label/fulfillment/refund transitions. Implemented compatibly: Case creation
   locks and re-reads the exact Order; label, fulfillment, buyer delivery
   confirmation and seller-refund reservations take that same Order lock before
   their fresh conflict checks. Two-session PostgreSQL proof for both winner
   orderings remains required.
6. Serialize replies on the Case row and use a post-lock timestamp.
   Implemented compatibly: different-body replies now take the same parent
   Case lock, re-read Case/actor authority, and use one PostgreSQL
   `clock_timestamp()` for Case `updatedAt`, discussion clocks, upload claims
   and CaseMessage `createdAt`. The duplicate advisory lock remains a separate
   replay guard. Two-session reply/cron proof remains required.

Disposable proof boundary (2026-07-26): the isolated branch includes
`scripts/case-lifecycle-postgres-proof.mjs` and a branch-scoped PostgreSQL 16
workflow. It refuses non-loopback targets and any database other than
`grainline_ci`, uses separate named clients, requires an observed PostgreSQL
`Lock` wait, cleans every synthetic row, and exercises 14 winner orderings:
Case versus label/fulfillment/delivery-confirmation/refund, different-body and
seller-first replies, pending-close reply versus a resolution mark, and seller
reply versus cron escalation. The harness and its static contracts are green
locally; this paragraph does not claim the database proof passed until a
successful workflow run is retained and reviewed.

Private evidence contract:

- Only processed JPEG, PNG and WebP images are accepted, with metadata stripped
  and a four-image/8 MiB-per-image message bound. PDFs remain prohibited.
- Objects live in `CLOUDFLARE_R2_PRIVATE_BUCKET_NAME`, which must have no
  public/custom domain. Database rows retain only an opaque key and verified
  content metadata; no public URL is persisted.
- Upload ownership is recorded in `DirectUpload`, then claimed atomically with
  the parent `CaseMessage`. Unclaimed objects use the existing retryable
  lifecycle cleanup, selecting the private bucket by stored storage class.
- Buyer, seller and PIN-verified staff retrieve evidence only through the exact
  parent Case route, which returns a 60-second signed read with no-store and
  no-referrer headers. Foreign users receive no object URL.
- Interactive history and account export include bounded attachment metadata.
  Binary evidence remains available through the authenticated Case route and
  is retained with the dispute/order record; it is not erased merely because a
  participant account is anonymized. Any future Case retention purge must
  enqueue private-object deletion before deleting attachment rows.
- The private bucket/env/grant/signed-read/foreign-denial smoke is a deployment
  prerequisite. Code presence is not evidence that the bucket is private.

The fixed-operation pattern does not authenticate a human caller by itself.
`grainline_app_runtime` can supply transaction context or function actor
arguments, so possession of that credential must be treated as authority to
impersonate a valid application actor within each granted function. Clerk
authentication, server-side actor resolution and route authorization remain
load-bearing. Case functions still derive targets, roles, timestamps, links and
event identity from locked rows so a normal application caller cannot choose
them independently.

Test contracts should be behavior-oriented for replaceable application
implementation details, but exact for security artifacts: function signatures,
security mode, pinned `search_path`, ACLs, table grants, policies, source-derived
authority fields and lock ordering remain strict structural tripwires.

Exit: focused product/security tests, TypeScript, lint and the full unit suite
are green. No RLS behavior has changed.

Release order remains migration first, application second. Automatic Vercel
production deployment from `main` is disabled; verify that invariant, apply the
guarded nullable/additive compatibility migrations, run the production
postflight, then deliberately promote the application that selects/writes the
new fields. Never deploy the application ahead of its schema.

## Phase 2: legacy inspection and invariant preparation

- Build a manual-main, owner-only, aggregate-only production inspector using
  the protected migration environment.
- Pin exact endpoint, owner/runtime roles, main commit, protected URL digest,
  clean checkout and a fresh mode-0600 runner evidence path.
- Count party/Order mismatches, self-party Cases, invalid message authors,
  author-kind backfill classes, lifecycle contradictions, timestamp
  anomalies, duplicate/tied message order and unbounded-history size.
- Stop after inspection. Any cleanup/backfill is a separate reviewed mutation
  with backup and rollback evidence.
- Add new-row party/Order, author and lifecycle invariants only after legacy
  state is exactly classified.

Exit: zero unclassified anomalies and a passed production invariant postflight.

## Phase 3: authority catalog design at Extra High

Every function must have fixed schema-qualified objects, pinned `search_path`,
no dynamic SQL, no PUBLIC execute, runtime-only execute where intended and no
generic caller-selected write target.

Candidate operation families to review:

- participant/staff Case detail and bounded CaseMessage history projections;
- staff queue/count projections;
- participant account export projection;
- participant open, reply, mark-resolved and eligible escalation;
- staff reply, escalation and resolution/finalization;
- Stripe dispute Case create/reopen;
- seller-refund active-Case resolution;
- cron claim/close/escalate batches plus per-row audited transition;
- account-deletion blocker/redaction;
- Order active-Case predicate for fulfillment/label/delivery/retention;
- seller-quality aggregate/existence checks.

User-authored Case text is valid caller input after size/sanitization. Buyer,
seller, target Case, author kind, status transition, timestamps, audit source,
notification recipient/link and replay identity are derived from locked durable
state. Staff resolution choice and bounded refund amount/stock restoration are
authorized staff decisions, not ordinary participant input.

Exit: ephemeral PostgreSQL proves own/foreign/staff/no-context reads, direct
DML denial, every write family, role drift, transition invariants, all race
orderings, account deletion, cron/webhook/refund behavior and rollback.

## Phase 4: compatible application conversion

- Deploy fixed functions while retaining old direct grants.
- Convert every current protected reference to its explicit destination (81 in
  the Phase 1B snapshot; the exact scanner gate controls later drift).
- Keep an exact zero-direct-access inventory gate.
- Prove buyer, seller, staff, cron, Stripe, refund, fulfillment, export,
  deletion, retention and metrics paths on the compatible database.
- Run authenticated route smoke without enabling RLS.

Exit: old and new app deployments can coexist with the preparation catalog.

## Phase 5: ENABLE activation

- Inspect/backup legacy rows and confirm no cleanup is pending.
- Apply exact policies and narrow grants; direct runtime writes become absent.
- Keep FORCE off for the first activation.
- Run exact catalog/grant audit, direct runtime denial, authenticated
  buyer/seller/staff smoke, cron/webhook-safe proof and rollback proof.

Exit: initial Case/CaseMessage RLS is accepted in production with sanitized
evidence and complete fixture/session/cache cleanup.

## Phase 6: FORCE hardening

- Use a separate FORCE-only migration that changes no row, policy, grant,
  function or app code.
- Fail closed unless exact accepted ENABLE catalog, table ownership,
  runtime/owner role posture, migration checksum and owner-session drain hold.
- Apply through the protected manual-main production migration workflow.
- Re-run actual pooled-runtime denial and authenticated route postflight.

Exit: Case and CaseMessage are FORCE-hardened with retained rollback and
postflight evidence. Only then begin the next sensitive group.
