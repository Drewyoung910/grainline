# Case, CaseMessage, and CaseMessageAttachment RLS Plan

Opened 2026-07-26. Current phase: Phase 4 compatible schema and application
conversion after a clean Phase 2 production inspection and completed Phase 3
authority/invariant proof. Production RLS remains off for Case, CaseMessage
and CaseMessageAttachment.

The behavior findings and current 80-reference source baseline live in
`docs/case-case-message-pre-rls-audit.md`. This document controls sequencing.
It contains no approved policy or function SQL.

## Scope boundary

Case, CaseMessage and CaseMessageAttachment must activate together because
both child visibility and write authority depend on the parent. They must not
activate with Order,
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
   their fresh conflict checks. The exact-head two-session PostgreSQL proof
   described below accepted both winner orderings.
6. Serialize replies on the Case row and use a post-lock timestamp.
   Implemented compatibly: different-body replies now take the same parent
   Case lock, re-read Case/actor authority, and use one PostgreSQL
   `clock_timestamp()` for Case `updatedAt`, discussion clocks, upload claims
   and CaseMessage `createdAt`. The duplicate advisory lock remains a separate
   replay guard. The exact-head two-session proof described below accepted the
   reply/cron, reply/staff and resolution-mark races.

Disposable proof boundary (2026-07-26): the isolated branch includes
`scripts/case-lifecycle-postgres-proof.mjs` and a branch-scoped PostgreSQL 16
workflow. It refuses non-loopback targets and any database other than
`grainline_ci`, uses separate named clients, requires an observed PostgreSQL
`Lock` wait and cleans every synthetic row. After review found that the real
mark-resolved, cron and staff-resolution routes were not fully represented by
the first proof, the candidate now exercises 21 winner orderings: Case versus
label/fulfillment/delivery-confirmation/refund, different-body and seller-first
replies, pending-close reply versus resolution mark, seller/discussion reply
versus cron, reply versus staff dismissal, resolution mark versus staff
dismissal, and resolution mark versus refund reservation. The expanded harness
and its static contracts are green locally.

Accepted disposable database proof: exact branch head
`00c175fbae1421f69f39d78fb9a22fec071916f5`, GitHub Actions run
`30216625774`, applied the complete guarded migration tree to PostgreSQL
16.14, converged the production-style runtime grants, passed migration status
and the final grant/RLS catalog audit, then completed all 14 two-session
orderings. Every check observed a PostgreSQL `transactionid` lock wait; the
harness reported `status=passed`, `persistentStagingChanged=false` and
`productionChanged=false`, and the service container was destroyed. The first
accepted run remains valid evidence for its 14 modeled orderings, but it is not
the acceptance gate for the expanded 21-ordering candidate after the CC-A15
fidelity finding. Exact code head
`9f4079fe2f6667f14e63943f9a9eee22f350f46b` superseded it in successful
GitHub Actions run `30217588001`: PostgreSQL 16.14 applied the full 163-migration
tree, converged production-style runtime grants, passed migration status and
the final grant/RLS catalog audit, then passed all 21 orderings with a real
`transactionid` wait observed for each. The bounded result reported
`status=passed`, `persistentStagingChanged=false` and
`productionChanged=false`; the service container and network were destroyed.
The migration bytes then changed during the final authority review, so that
run was not reused as acceptance for the current tree. Exact hardening head
`4dc57266c18abf7ee4d4a8a700bcd2a52d0f3185` passed dedicated GitHub Actions
run `30218521286`: the complete migration tree applied to disposable
PostgreSQL, production-style runtime grants converged, migration status and
the final grant/RLS catalog audit passed, and all 21 winner orderings again
observed real PostgreSQL lock waits. Exact-head general CI run `30218522907`
also passed the compatibility-tree guards, ephemeral database proofs,
TypeScript, lint, 2,089-test suite, high-severity dependency audit and
production build. These runs changed no persistent staging or production
database.
The earlier failed run, `30215504361`, is
retained evidence: Prisma rejected the mixed
three-statement concurrent-index migration with PostgreSQL `25001` before the
race harness ran. Commit `4ede31b7` repaired the unapplied branch-only tree by
keeping `CREATE INDEX CONCURRENTLY` alone and moving the two ordinary drops to
`20260726183600_drop_legacy_case_message_history_indexes`; it did not weaken or
skip migration deployment.

Private evidence contract:

- Only processed JPEG, PNG and WebP images are accepted, with metadata stripped
  and a four-image/8 MiB-per-image message bound. PDFs remain prohibited.
- Objects live in `CLOUDFLARE_R2_PRIVATE_BUCKET_NAME`, which must have no
  public/custom domain. Database rows retain only an opaque key and verified
  content metadata; no public URL is persisted.
- Upload ownership is recorded in `DirectUpload`, then claimed atomically with
  the parent `CaseMessage`. Unclaimed objects use the existing retryable
  lifecycle cleanup, selecting the private bucket by stored storage class. An
  already-claimed upload cannot be rebound to a different record type or
  record id, and the database requires public uploads to have a public URL
  while private uploads must not have one.
- Buyer, seller and PIN-verified staff retrieve evidence only through the exact
  parent Case route, which returns a 60-second signed read with no-store and
  no-referrer headers. Foreign users receive no object URL, and Case-message
  creation/retry responses return attachment metadata without the private
  object key.
- Interactive history and account export include bounded attachment metadata.
  Binary evidence remains available through the authenticated Case route and
  is retained with the dispute/order record; it is not erased merely because a
  participant account is anonymized. Account deletion therefore removes
  lifecycle rows only for public uploads; retaining the private lifecycle row
  is required for authenticated evidence reads. Any future Case retention purge must
  enqueue private-object deletion before deleting attachment rows.
- The private bucket/env/grant/signed-read/foreign-denial smoke is a deployment
  prerequisite. Code presence is not evidence that the bucket is private.
- `CASE_EVIDENCE_ATTACHMENTS_ENABLED` remains absent or exactly `false` for the
  compatibility deployment. The API and UI fail closed until DirectUpload
  activation/postflight and the private-bucket/authenticated-route smoke pass;
  only then may the exact lowercase value `true` be promoted.

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

Final Extra-High compatibility review (2026-07-26) also closed six defects
before release packaging:

- claimed uploads are now immutable to another source type/id, including the
  concurrent link race;
- private object keys are stripped from every new, duplicate and retry
  Case-message response;
- locked Case and actor reads are sequential inside the interactive
  transaction;
- a staff user who is also a Case party receives participant semantics on both
  upload and message paths;
- contended staff/webhook refund reservations use database
  `clock_timestamp()` after the Order-lock wait rather than a stale
  request-time JavaScript timestamp; and
- account anonymization preserves claimed private-evidence lifecycle rows
  while continuing to delete public-media lifecycle rows and expire unclaimed
  private uploads through normal cleanup.

The Git-integrated Vercel Preview for documentation head `9f8b0f26` created
deployment `dpl_EM6Sr1c1BV1LZrXE43tKPamaszDG` and failed before compilation at
the existing runtime database isolation guard with `DATABASE_URL_SHAPE`. That
is the expected fail-closed result for the inherited, unreviewed shared
Preview database configuration. The guard was not weakened, no migration ran,
and the red Preview is not a production or Case-proof failure. A later
authenticated private-bucket smoke must use a deliberately isolated reviewed
Preview/database pairing; this branch does not authorize or claim that
provider proof.

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

Phase 2 scaffold checkpoint (2026-07-28): the isolated candidate adds
`scripts/case-case-message-legacy-inspect.mjs` plus a manual-main protected
workflow. It pins the exact production endpoint, owner/runtime roles, protected
URL digest, dispatched main commit, clean checkout and a fresh mode-0600
evidence path. The one repeatable-read, engine-attested read-only transaction
returns only fixed aggregate counts and bounded enum distributions; it does not
export Case ids, message text, participant ids or private object keys.

The exact aggregate SQL also runs after the complete migration tree in the
PostgreSQL 16 CI service through
`scripts/case-case-message-legacy-inspection-postgres-proof.mjs`. That proof is
hard-limited to loopback `grainline_ci`, executes the production query rather
than merely matching its text, validates the exact result schema and rolls
back. This scaffold does **not** claim a production inspection, classified
legacy state, cleanup, invariant, policy, grant or RLS change.

The production inspection must run before the separately staged DirectUpload
compatibility-key retirement: it deliberately asserts the compatible
pre-retirement `CaseMessageAttachment.objectKey` column and DirectUpload
RLS-off posture. The cleanup-only R2 credential proof remains an independent
gate for DirectUpload activation and private Case evidence; it does not block
this read-only Case classification work. Stop after reporting production
counts. Any backfill, repair or constraint is a later evidence-driven mutation
with its own backup and rollback boundary.

First production dispatch record (2026-07-28): protected workflow run
`30412359026` at exact main commit
`7767ae3ae7380ff91a74db0e8a1830f17c8d8b84` failed closed before connecting or
executing the aggregate query. The PostgreSQL channel-binding helper received
the guarded identity summary instead of a parsed `URL` and raised
`parsed must be a URL`. No transaction ran, no evidence artifact was uploaded,
and no production data, catalog, grant or RLS state changed. The corrective
checkpoint constructs the actual PostgreSQL client options from the already
validated `directUrl` and exercises that construction in the focused test so a
config-only test cannot mask this boundary again.

Fresh production inspection record (2026-07-28): protected run `30413133843`
(job `90453636790`) passed at exact main
`de9ad52ff6c7dfb58a44773ec9e14e44a103f0a4` after PR #83 and fresh merged-main
CI run `30412936579`. PostgreSQL attested the repeatable-read transaction as
read-only. The inspection found zero Cases, zero CaseMessages and zero
CaseMessageAttachments. Every relationship, lifecycle, author-kind, timestamp,
attachment, DirectUpload/reference and blocking count was zero; every bounded
distribution was empty. No cleanup or backfill is required.

The mode-0600 sanitized off-worktree artifact is
`case-case-message-legacy-inspection-de9ad52ff6c7dfb58a44773ec9e14e44a103f0a4.json`;
its SHA-256 is
`dd4194a39e83e7c4363e9b251d495e66534df3d83c5f3ac2ab521a15dbae8654`.
It contains fixed aggregate counts, bounded enum distributions and reviewed
target/source metadata only—no row ids, message text, participant ids, object
keys or credentials. Production retained Case/CaseMessage/attachment RLS off,
DirectUpload RLS off, DirectUploadReference FORCE with zero policies, and the
runtime role as `NOBYPASSRLS`. Phase 2 is complete; Phase 3 may design new-row
invariants and the fixed Case authority catalog without a legacy mutation.

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

Phase 3 catalog checkpoint (2026-07-28): the isolated candidate adds
`scripts/case-case-message-authority-catalog.mjs`, its exact inventory-drift
test and `docs/case-case-message-authority-catalog.md`. It maps all 80 current
references across 29 sources to 26 fixed operations. The boundary explicitly
includes CaseMessageAttachment rather than treating private evidence as an
independent activation.

The review rejected route-provided `staffPinWasVerified` booleans because
PostgreSQL cannot attest a session-bound PIN. Staff functions revalidate the
current database role while the PIN remains an authenticated-route
precondition. Refund finalization binds to a database-generated resolution
claim and exact durable local payment evidence instead of accepting a generic
provider result. Account-deletion redaction derives its User from a locked
`LOCAL_ANONYMIZE` side-effect row rather than taking a free mutation target.
Cron target selection and transition are one bounded
`FOR UPDATE SKIP LOCKED` database operation with per-row audit evidence, not a
caller-selected claim/transition pair.

The Phase 3 review also found that the current Stripe dispute helper can reopen
a terminal Case while leaving `refundAmountCents` and `stripeRefundId` behind.
The fixed dispute operation clears the complete Case-level terminal snapshot
while retaining the durable Order payment/audit history. A webhook-created
Case records its exact source in `Case.openedByPaymentEventId` and may begin
without a falsely buyer-authored opening message; the ordinary buyer-open
operation still creates its first message atomically.

Extra-High review of the first compatible operation found two authority gaps
before merge. `SystemAuditLog` still has broad runtime CRUD and therefore
cannot be the immutable replay boundary. Stripe delivery is also unordered, so
a valid but superseded `charge.dispute.created` source cannot be accepted only
because its signature was verified earlier. The corrected candidate uses a
separate zero-policy, zero-table-grant
`CaseStripeDisputeApplication` replay ledger, and the function rejects an
older event or an open event superseded at the same provider timestamp by a
terminal dispute event. `SystemAuditLog` remains co-committed observability,
not authority.

The catalog also records honest cross-group limits: PostgreSQL validates local
payment evidence but does not independently attest Stripe, and
Order/OrderPaymentEvent/AccountDeletionSideEffect direct-write hardening
remains in later groups. New Case/message/audit identities must be generated
inside PostgreSQL (UUID text is compatible with the opaque String ids); Prisma
`cuid()` is a client default, not a database default.

Phase 3 invariant hard-review checkpoint (2026-07-28): the draft-only
Case/CaseMessage/attachment and private resolution-claim SQL remains outside
the migration tree and is exercised only inside the disposable PostgreSQL
proof. The first engine pass caught quoted trigger table-name dispatch and was
corrected to exact `TG_RELID`/`regclass` identity. The subsequent authority
review strengthened mutable source locks to `FOR SHARE`, fixes the canonical
authority order as actor User, then Order when applicable, then parent Case for
the compatible app and later functions, locks the complete retained
Order/seller relationship,
and prevents a claim from carrying payment evidence while still
`PROVIDER_PENDING`. Once linked, provider evidence is immutable; terminal
clocks cannot precede provider evidence or exceed the claim update clock.
The invariant layer deliberately does not claim that a terminal
Case-to-`UNDER_REVIEW` transition itself proves Stripe provenance: that
transition remains a compatibility shape until direct runtime writes are
replaced by the source-bound `case_stripe_dispute_apply` operation.

External staff refunds use a private `CaseResolutionClaim` service ledger,
created FORCE-protected with zero policies and zero runtime/PUBLIC table
privileges. Prepare, explicit bounded Stripe-evidence recording and finalize
are separate fixed operations. A provider-pending claim is never released by
timeout; retry/reconciliation reuses the exact claim-derived Stripe
idempotency scope. Only a PIN-verified current ADMIN can make the explicitly
audited human decision that Stripe has no provider effect and advance it to
the distinct terminal `RELEASED_NO_PROVIDER_EFFECT` state. That state does not
pretend the Case or provider action was finalized.

Seller verification, seller metrics and guild-revocation predicates are three
separate fixed operations. The review rejected one generic arbitrary-seller
quality function because it exposed a broader dispute-count/timestamp oracle
than any source requires.

Exit: ephemeral PostgreSQL proves own/foreign/staff/no-context reads, direct
DML denial, every write family, role drift, transition invariants, all race
orderings, account deletion, cron/webhook/refund behavior and rollback.

## Phase 4: compatible application conversion

- First add the nullable exact Stripe-dispute source and private
  `CaseResolutionClaim` ledger in one coexistence-safe preparation migration.
  The new ledger is born ENABLE plus FORCE with zero policies and zero
  runtime/PUBLIC table privileges; the migration does not add strict
  Case/CaseMessage triggers, participant policies or callable resolution
  operations.
- Add each reviewed fixed operation while retaining old direct grants. The
  Stripe-dispute operation also adds its own private immutable replay ledger;
  it is not bundled with Case participant policies or direct-grant revocation.
- Convert every current protected reference to its explicit destination (80 in
  the current exact scanner; earlier Phase 1B counts remain historical
  evidence rather than an activation target).
- Keep an exact zero-direct-access inventory gate.
- Prove buyer, seller, staff, cron, Stripe, refund, fulfillment, export,
  deletion, retention and metrics paths on the compatible database.
- Run authenticated route smoke without enabling RLS.

Exit: old and new app deployments can coexist with the preparation catalog.

Phase 4 compatible-schema checkpoint (2026-07-28): the candidate migration
adds `Case.openedByPaymentEventId`, exact same-Order composite foreign keys,
the nullable `Order.caseResolutionClaimId` lease and the private
`CaseResolutionClaim` provider-handshake ledger. Its enum is removed from
PUBLIC and granted only the runtime USAGE needed for later typed fixed
functions; the table and invariant trigger functions remain runtime-private.
The strict Case/CaseMessage invariant draft now consumes this prepared shape
instead of attempting to recreate it. This checkpoint is code-only:
production migrations, Case RLS and app deployment remain unchanged.

Phase 4 Stripe-dispute authority checkpoint (2026-07-28): the isolated,
unmerged candidate accepts only one exact same-Order `OrderPaymentEvent`,
locks Order, payment source, complete seller graph and Case in canonical
order, derives all participants/linkage inside PostgreSQL, and clears the
complete terminal Case snapshot on a legitimate reopen. Replay identity is
held in private `CaseStripeDisputeApplication` rather than caller-writable
`SystemAuditLog`. The function rejects malformed, wrong-charge, terminal and
superseded sources. The migration does not enable participant RLS, revoke
legacy Case grants, deploy application conversion or authorize production
migration.

Implementation checkpoint `3416516e29ea92868c7746c741030f0f0324f850`
is pushed in draft PR `#88`. The PR is temporarily based on `main` so the
repository's pull-request-only CI can run the full PostgreSQL 16 migration and
rollback-only authority proof; it includes the exact PR `#87` schema
prerequisite until that predecessor merges. This is a CI/review arrangement,
not production migration or deployment authorization.

## Phase 5: ENABLE activation

- Inspect/backup legacy rows and confirm no cleanup is pending.
- Apply exact policies and narrow grants; direct runtime writes become absent.
- Keep FORCE off for the first activation.
- Run exact catalog/grant audit, direct runtime denial, authenticated
  buyer/seller/staff smoke, cron/webhook-safe proof and rollback proof.

Exit: initial Case/CaseMessage/CaseMessageAttachment RLS is accepted in
production with sanitized evidence and complete fixture/session/cache cleanup.

## Phase 6: FORCE hardening

- Use a separate FORCE-only migration that changes no row, policy, grant,
  function or app code.
- Fail closed unless exact accepted ENABLE catalog, table ownership,
  runtime/owner role posture, migration checksum and owner-session drain hold.
- Apply through the protected manual-main production migration workflow.
- Re-run actual pooled-runtime denial and authenticated route postflight.

Exit: Case, CaseMessage and CaseMessageAttachment are FORCE-hardened with
retained rollback and postflight evidence. Only then begin the next sensitive
group.
