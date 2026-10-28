# MakerVerification RLS options

Date: 2026-10-28

Status: **Option B selected for isolated compatible preparation.** This
decision authorizes audit-backed candidate work only. It does not authorize a
Production migration, grant change, deployment, or RLS activation.

Reviewed source baseline:
`857bc94706913a4d5c4368afa99de0a55bb2437c`.

The required domain audit is
`docs/maker-verification-pre-rls-audit.md`.

## Domain shape

`MakerVerification` is neither a public catalog table nor a simple owner-only
table. One row combines applicant-authored evidence, staff-only attribution,
seller-visible decision notes, a multi-stage badge state machine, system
revocations, notification validation, export, and deletion redaction.

The public badge itself lives on `SellerProfile`. There is no reason to expose
this base table to a public reader. The owner needs a narrow projection and two
complex application transitions. Staff and service work already relies heavily
on fixed database operations.

## Invariants every option must preserve

1. One verification row belongs to exactly one SellerProfile and only that
   active seller may submit or read its owner projection.
2. Owners do not receive `reviewedById` or another seller's evidence.
3. Member and Master applications accept only their exact allowed predecessor
   state, cooldown, actor, and bounded input.
4. Badge decisions keep MakerVerification, SellerProfile,
   SellerProfilePrivate, audit evidence, and source-bound notifications
   consistent.
5. Staff queue and decisions require the isolated staff database role, an
   active EMPLOYEE/ADMIN actor, and the existing Admin PIN application boundary.
6. Only ADMIN can reinstate a Guild Member or exercise the approved sales
   override.
7. Cron/service transitions remain source-specific and cannot become generic
   caller-selected status writers.
8. Account export excludes internal reviewer identity. Deletion redaction is
   owner-bound, idempotent, and preserves the intentional rejected sentinel.
9. Activation changes authority only. It does not rewrite rows, reinterpret
   narratives, or drop columns.

## Options

| Option | Shape | Caller conversion | Protection | Rollback | Main limits |
| --- | --- | --- | --- | --- | --- |
| **A. Applicant row policies plus fixed staff/service functions** | Owner `SELECT`, `INSERT`, and restricted `UPDATE` policies use `app.user_id`; staff/service transitions remain functions. | Wrap owner calls in actor transactions; still add functions for staff queues, export/deletion, cross-table Master application and service jobs. | Row ownership blocks cross-seller reads. | Restore predecessor grants and disable RLS before restoring the old app. | RLS cannot restrict columns, so direct owner SELECT exposes reviewer identity and any future internal column. A policy cannot safely encode the multi-table application state machine or the reapply/reinstate race. Most nontrivial work still needs functions. |
| **B. Policyless RLS with zero direct table authority and fixed operations** | No direct runtime/PUBLIC base-table authority. Owner, staff, export/deletion, cron, and notification paths use purpose-bound operations. | Convert eight direct operations; retain/converge the existing eight function families; add pagination and atomic owner transitions. | Strong fail-closed boundary. New columns are not automatically readable. Every state mutation has an explicit contract and can co-commit paired state. | Preparation remains additive. Activation rollback restores predecessor grants and disables FORCE/RLS before app rollback. | More SQL contracts than direct owner policies. Behavior parity, function ownership, and concurrency must be tested on the full schema to avoid SQL drift. The shared credential can still invoke granted operations, so functions must derive actors and constrain targets. |
| **C. Split applicant evidence from review/lifecycle state** | Move narratives and portfolio fields to an owner table; keep reviewer/status fields in a staff/service table. | Convert every reader/writer, backfill a one-to-one relation, and make every decision span two tables plus SellerProfile/private state. | Strong physical separation between applicant evidence and staff metadata. | Maintain dual-read compatibility and restore the old layout; no old-column drop in the security release. | Adds a new synchronization boundary and backfill risk. Both halves are private and still require fixed multi-table transitions, so the split does not remove the hard part. |
| **D. Grant-only hardening without RLS** | Revoke unused privileges but retain broad runtime reads/writes needed by direct Prisma paths. | Minimal. | Reduces accidental unused operations only. | Restore grants. | A missed application check or compromised runtime query can enumerate narratives, reviewer identity, and notes or corrupt any seller's badge lifecycle. It does not meet the defense-in-depth goal. |

## Recommendation

Choose **Option B**.

It matches the real boundary: the base table is private, the owner needs a
projection rather than every column, and both application writes are state
transitions rather than ordinary CRUD. Option B also closes the conversion-
critical reapply/reinstate race by putting the read, canonical locks, expected
state check, and write in one operation.

Option A looks smaller but is not. Staff queues, staff decisions, Master
application, cron transitions, export, deletion, and notification validation
would still need fixed operations. Its remaining direct owner access would add
column-exposure and state-machine risk for little code savings.

Option C is disproportionate because none of the table is public and the
existing one-row lifecycle needs atomic transitions. Option D retains the main
cross-seller risk.

## Expected operation surface

Preparation should converge on:

- one owner Member apply/reapply transition;
- one owner Master application transition;
- existing narrow owner state/dashboard projections;
- one owner export projection and one deletion-redaction operation;
- cursor-paged staff queues/rosters and true counts;
- existing exact staff target and seven-transition operation;
- existing source-bound system Member/Master operations; and
- existing source-bound Notification validation.

No generic row lookup or generic status update should be granted.

## Long-term safety and scalability

- Adding a column does not expose it to applicants or staff automatically.
- The pending queue uses `(status,appliedAt,id)` cursor pagination instead of
  an unobservable hard cap.
- State-machine changes have one database contract per product action rather
  than two duplicated application writers.
- Atomic operations keep badge state and audit evidence consistent under
  retries and concurrency.
- Full-chain tests exercise the production column types and installed function
  owners rather than hand-built miniature tables.
- The generic private-table release workflow can activate ENABLE plus FORCE in
  one release after compatible callers are live; no new family of one-off
  workflows is justified.

## Release shape

1. Install additive operations with predecessor grants unchanged.
2. Convert callers and deploy the compatible application.
3. Prove lifecycle parity, cross-owner denial, pagination, deletion/export, and
   the owner/staff races against the full migration chain.
4. Inspect Production read-only and drain incompatible deployments.
5. Run one separately approved activation that revokes direct authority and
   applies ENABLE plus FORCE.

## Decision record

- [x] Select Option B for isolated compatible preparation (Codex, 2026-10-28,
  under Drew's standing instruction to choose the strongest long-term design
  that remains proportionate and scalable).
- [ ] Production activation approved.
