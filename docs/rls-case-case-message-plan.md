# Case and CaseMessage RLS Plan

Opened 2026-07-26. Current phase: Phase 1A compatible product work.
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
The existing live Notification function may receive a narrowly reviewed
Case-decision extension for the missing seller notice, but Notification policy,
grants and unrelated families remain unchanged.

The older feasibility sequence placed Case after Order because of these joins.
The current program deliberately audits Case first: it is a narrower private
dispute boundary, Conversation/Message is complete, and owner-backed fixed
Case functions can validate an unprotected Order without requiring Order RLS.
Order/payment/shipping still receives its own later audit and release.

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
3. Carry the accepted first-party Case evidence attachment requirement into
   the reviewed compatible schema design.

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
2. Add the exact `(caseId, createdAt, id)` history index and the first-party
   `CaseMessageAttachment` model with parent visibility, verified upload
   ownership, export, deletion and retention behavior.
3. Deliver staff Case decisions to the seller with source-derived seller copy
   through the existing fixed Notification boundary.
4. Make Case creation, participant escalation and staff resolution audit
   evidence atomic with the database state transition.
5. Establish the shared Order-lock protocol for Case creation and conflicting
   label/fulfillment/refund transitions.
6. Serialize replies on the Case row and use a post-lock timestamp.

Exit: focused product/security tests, TypeScript, lint and the full unit suite
are green. No RLS behavior has changed.

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
- Convert all 69 protected references to their explicit destination.
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
