# AdminAuditLog pre-RLS audit

Date: 2026-11-02

Status: domain audit complete; Option B selected in
`docs/admin-audit-log-rls-options.md`. The isolated compatible source
conversion is zero-direct and its 14-operation migration plus private insert
fence passes focused PGlite and complete-chain PostgreSQL 17 behavior/ACL
proof. Durable in-transaction deletion plans, deterministic concurrency cases
and 100,000-row query plans now pass. The reusable release catalog seals all
15 new functions, 23 retained functions, two indexes and one trigger, and its
real-catalog inspector proof passes. Compatibility, rollback and the complete
local release-workflow proof now pass, including pending, applied-unrecorded and
applied restart states with the actual Prisma ledger command. Exact-branch
PostgreSQL 17 CI remains the preparation acceptance gate. No Production, merge,
deployment, grant, or RLS action is authorized by this document.

## Baseline and method

- Public-main source baseline:
  `12a4dfc492412ff52ff94d921e20e7026c4cff38`.
- Isolated serial-chain baseline:
  `2a10b3d354e766ef787249f790a19b4d3a92212b`.
- Source inventory: all `src/` references to `AdminAuditLog` and the Prisma
  delegate, including raw SQL, generic-client aliases and transaction clients.
- Database inventory: the complete 462-migration PostgreSQL 17 schema in the
  disposable `grainline_ci` database, queried through `pg_proc`, `pg_class`,
  `pg_constraint`, `pg_indexes` and function ACL checks.
- Prior Claude findings were treated as allegations and rechecked against the
  source and installed disposable catalog. Raw audit notes were not imported
  or modified.

## Domain and data classification

`AdminAuditLog` is private security and operations evidence. Its name and
`adminId` field are historical: the actor may be an admin, employee, ordinary
user, or automated action attributed to a related user.

| Column | Classification | Invariant |
| --- | --- | --- |
| `id` | durable evidence identity | immutable; referenced by two service ledgers |
| `adminId` | private actor user id | valid `User`; not proof the actor was an admin |
| `action` | security/product event type | immutable after insert; bounded to 100 characters |
| `targetType`, `targetId` | private resource attribution | immutable after insert; target is intentionally polymorphic |
| `reason` | potentially sensitive staff/user text | sanitized and bounded; privacy redaction is allowed |
| `metadata` | sensitive structured evidence | <= 1,000,000 bytes; privacy redaction is allowed |
| `undone*` | one-way reversal evidence | false/null to true/timestamp/actor/reason exactly once |
| `createdAt` | durable ordering clock | immutable |

`CaseOpenApplication.auditLogId` and
`OrderRefundReconciliation.auditLogId` both use unique, restricting foreign
keys. Audit rows therefore cannot be pruned or replaced without considering
those ledgers.

## Current catalog posture

The disposable complete schema reports:

- RLS disabled and FORCE disabled;
- ordinary runtime table `SELECT`, `INSERT`, `UPDATE` and `DELETE`;
- no non-internal triggers;
- primary key plus indexes on `adminId`, `(targetType,targetId)`, `createdAt`
  and `undone`;
- a `NOT VALID` 1,000,000-byte metadata check, which still protects new rows
  but requires a pre-activation inventory for historical violations; and
- 23 current database functions whose installed bodies reference the table.

Of those functions, 21 insert audit evidence, five read evidence, and some do
both. Twelve are executable by the ordinary app runtime, nine by the isolated
staff role, and the rest are internal helpers. Every current function is
`SECURITY DEFINER` in the disposable schema. Exact identities, owners, ACLs,
security mode, volatility, search path and source hashes remain activation
inputs; static migration-text matching is not sufficient.

The 23 current dependencies cover:

- case open, participant resolution, escalation, staff resolution,
  reconciliation and provider recovery;
- order refund reconciliation and three staff order mutations;
- seller broadcast deletion, Guild transition, feature transition and listing
  review transition;
- support-request and user-report staff transitions;
- ban-repair target discovery; and
- notification source validation.

## Exact application caller inventory

Six files performed 20 executable direct operations on the audited isolated
baseline. The current isolated candidate has converted all six and the
machine-checked inventory reports zero delegate operations and zero raw SQL
callers outside `src/lib/adminAuditLogAccess.ts`:

The machine-checked inventory runs with:

```sh
npm run audit:admin-audit-log-consumers
```

| Caller | Direct operations | Required authority |
| --- | --- | --- |
| `src/app/admin/audit/page.tsx` | count, paginated `findMany` | current ADMIN plus fresh PIN; bounded global page/filter through staff role |
| `src/lib/audit.ts` | related-sync read, generic create, undo source read, one-way undo update, undo evidence insert | exact actor/staff action families and atomic undo |
| `src/lib/ban.ts` | recent-ban read, side-effect evidence insert, ban evidence insert, latest-ban read, unban evidence insert | staff/source-bound ban lifecycle |
| `src/lib/banSideEffectRepair.ts` | side-effect evidence insert, two related-log reads, bounded ban repair scan | bounded repair service plus original-action binding |
| `src/lib/accountDeletion.ts` | exact-metadata raw read, actor/target read, user-delete evidence insert | exact active deletion claim and structurally related candidates |
| `src/lib/accountDeletionSideEffects.ts` | reason/metadata update | exact claimed `AUDIT_REDACT` side effect and immutable non-redacted fields |

The account export and terms routes call the generic helper rather than the
delegate directly. Admin verification, PIN verification and listing AI review
also call that helper. Those call sites are part of the writer inventory even
though the direct Prisma call is centralized.

No current source relation traversal through `User.adminActions`,
`CaseOpenApplication.auditLog` or `OrderRefundReconciliation.auditLog` was
found. The zero-direct source gate must nevertheless cover relation selects,
raw SQL and aliased clients so a future traversal cannot bypass it.

## Principal and operation matrix

| Operation | Principal | Required checks | Result bound |
| --- | --- | --- | --- |
| Staff audit page count/page | ADMIN on isolated staff role | active account, role, PIN at page boundary, allowed filter | count plus <= 30 rows, page capped at 1000 |
| Terms acceptance evidence | active account owner | actor = target; exact terms version/timestamps from accepted transition | one row in same transaction |
| Account export evidence | freshly reverified active owner | actor = target; exact action and route family | one row before download |
| Automated AI hold evidence | listing-owner-bound service path | exact listing/seller and current held state | one row; never represented as human admin |
| Staff ban/unban evidence | active staff actor | source-bound capability and exact target transition | one row in transition transaction |
| External ban side-effect evidence | bounded repair/service | exact original ban row, target and side-effect result | one idempotent action-family row per outcome |
| Undo source/claim | different active ADMIN | undoable action, <= 24h, not already undone, expected domain state | one exact row plus immutable source payload |
| Undo completion evidence | same undo actor/transaction | successful domain reversal and claimed source row | one `UNDO_*` row |
| Account-deletion self-evidence | exact active local anonymize claim | actor = target = deleting user | one row before user scrub |
| Deletion candidate enumeration | exact deletion actor/claim | actor/target ids or exact JSON scalar account reference only | keyset batches <= 500 |
| Deletion redaction | claimed `AUDIT_REDACT` side effect | exact log id and claim generation/token; reason/metadata only | one row, replay-safe |
| Domain function evidence | existing fixed operation | function-specific actor/source/state validation | exact co-committed row(s) |

No ordinary principal needs direct table deletion or unrestricted update.

## Workflow audit

### Staff page and filtering

The page requires ADMIN access and a fresh PIN, counts the selected action,
then reads 30 rows ordered by `(createdAt DESC,id DESC)`. Page input is capped
at 1000. Staff labels are already fetched through the isolated staff role.
The new audit-page operation should use that same role and return only the
display columns; it must not expose raw metadata to the page.

The current indexes do not exactly match the action-filtered stable order.
Preparation should add online-compatible indexes for
`(createdAt DESC,id DESC)` and `(action,createdAt DESC,id DESC)` after checking
Production cardinality and plans. This is a scalability gate, not permission
to add an unbounded search API.

### Generic application writer

`logAdminAction` is used for PIN results, blocked verification approvals,
external Clerk synchronization, automated listing holds and undo follow-up.
`logUserAuditAction` adds terms acceptance and account export. The helper
currently accepts arbitrary action/target/metadata and ordinary runtime has
full table insert authority.

Preparation must replace the generic database authority with exact action
families. A shared TypeScript adapter may remain, but the database operation
must distinguish actor-self, isolated-staff, automated listing and ban-repair
families. Failure semantics remain explicit: terms acceptance and successful
export fail closed on missing audit evidence; some external-provider follow-up
logs remain best effort and emit Sentry evidence.

### Ban, unban and external convergence

Ban/unban co-commit core state and their primary audit rows. Provider-side
Clerk/session and checkout cleanup happen after commit and add separate result
rows. A bounded repair scan looks back 14 days, inspects at most 100 bans and
processes at most the requested batch.

The fixed operations must preserve original-action binding and must not let a
caller attach a side-effect result to an unrelated ban. Repair discovery must
stay on the isolated staff/service boundary. Concurrent repair attempts may
race today; the preparation proof must require idempotent convergence or one
durable winner without deleting either evidence trail.

### Undo

Undo first reads the source evidence, rejects self-undo, non-undoable actions,
expired windows and prior completion, then obtains domain-specific
capabilities. Inside one transaction it atomically flips the one-way undo
fields, performs the ban or listing reversal and inserts `UNDO_<ACTION>`.

The conversion must keep the audit claim and domain reversal in the same
transaction. A read followed by an unrestricted staff update is not
acceptable. The claim operation should return only the exact immutable fields
needed by the app, and the completion operation must bind the undo evidence to
the claimed source row and actor.

Clerk synchronization remains post-commit and retryable through related audit
rows. A failed external sync does not roll back the already-completed database
undo.

### Account deletion and privacy redaction

The prior global substring-redaction defect is fixed on the audited baseline.
Candidate collection now includes only rows structurally related through
`adminId`, target ids, or an exact JSON scalar equal to the user id, Clerk id
or seller-profile id. It no longer scans for generic city/state/name
substrings.

Collection now runs through a fixed operation in batches of at most 500. The
structurally exact JSON-path predicate can scan the table because no normalized
reference index exists, so the disposable PostgreSQL 17 proof measures the
exact predicate rather than assuming an index. With 100,000 realistic audit
rows and three matches, it returns the complete candidate set in about 70 ms.
That is accepted for the rare account-deletion path; repeat the proof and
design a normalized reference projection before the table reaches one million
rows or the candidate scan exceeds 500 ms. A broad speculative GIN index is
not part of this security release.

Redaction side effects replace only `reason` and `metadata`; identity, action,
target, undo fields and time remain immutable. Version-two retry rows contain
only the already-redacted patch and PostgreSQL-computed SHA-256 fingerprints
of the source metadata/reason; they never persist the raw account-deletion
needles. The claim-bound database operation locks the exact audit row, refuses
a fingerprint mismatch, applies the patch and clears/completes the exact side
effect atomically. Candidate collection and already-redacted plan creation now
run inside the local-anonymization transaction before its durable completion,
so a commit cannot leave the account anonymized without its retry plans. Raw
needles never enter a side-effect payload.

Every audit insert, including retained domain functions and predecessor direct
table writes, crosses one shared transaction-scoped database fence, so normal
audit writers remain concurrent. Account deletion acquires the matching
exclusive fence before its first domain read or lock. An earlier writer
commits before the deletion scan; a later writer waits, then the insert trigger
refuses it if `adminId`, `targetId`, or any exact JSON scalar structurally
references a deleted user. The deletion transaction retries serialization and
deadlock aborts as one DB-only unit. Deterministic PostgreSQL 17 proofs cover
independent concurrent writers, both writer orders, undo-before-redaction with
undo fields preserved, and two undo attempts with one durable winner.

### Existing database writers and readers

The 23 installed functions already encapsulate cross-domain transitions and
must not be rewritten merely to satisfy RLS. Preparation inventories their
exact installed definitions and identifies which are externally executable
versus internal. Policyless FORCE permits the owner functions to keep their
current behavior while direct runtime/staff access is revoked.

Any function still granted to the ordinary runtime must retain its own
source/actor validation. RLS does not provide a second permission check inside
a `SECURITY DEFINER` function.

## Concurrency and crash matrix

| Race/crash | Current contract | Required preparation/activation proof |
| --- | --- | --- |
| Two admins undo one row | one `updateMany(...undone=false)` winner | two sessions; one complete undo and one stable replay result |
| Undo vs account redaction | both may update the same row | no lost undo fields and no restored personal data |
| Ban transition vs repair scan | repair sees only committed ban evidence | no forged/mismatched original id; eventual external convergence |
| Two repair workers | duplicate provider calls may be idempotent | one durable outcome family or safe replay evidence |
| Domain transition vs audit insert failure | primary fail-closed paths roll back | executed atomic rollback for each converted transaction family |
| External provider success vs audit failure | provider effect may succeed while result log is missing | existing retry/telemetry remains; no duplicate destructive effect |
| Account deletion crash before candidate collection | plan collection/enqueue is in the same transaction as anonymization | rollback leaves both absent; commit makes already-redacted plans durable before local completion |
| Audit insert vs account deletion | shared transaction fence orders every insert before or after deletion | earlier insert is planned; later structurally related insert is refused; deadlock victim is retry-safe |
| Account deletion retry after newer undo | stale payload must not erase undo state | redaction touches reason/metadata only and preserves later allowed fields |
| Direct row delete/PK update attempt | currently allowed to runtime | denied after activation, including referenced rows |
| User/ledger foreign-key action under FORCE | owner functions and database FK checks continue | executed hard-delete/restrict/cascade behavior on PostgreSQL 17 |

## Findings and disposition

| Finding | Severity | RLS disposition |
| --- | --- | --- |
| Ordinary runtime currently has full CRUD on private security evidence | High hardening gap | **BLOCKS_ACTIVATION**; zero direct runtime/staff/PUBLIC authority is the selected end state |
| `adminId` includes users and automated actors, so it is not an ownership boundary | Medium design risk | **BLOCKS_SIMPLE_POLICY_DESIGN**; Option A rejected |
| Generic writer accepts arbitrary action/target/metadata | Medium integrity risk | **FIX_BEFORE_ACTIVATION** with exact action-family operations |
| Audit page and user/system rows share one queue and the UI labels every actor “Admin” | Low product accuracy | **DEFERRED_PRODUCT_WORK**; preserve rows, add actor-kind display/filter later |
| Automated `AI_HOLD_LISTING` is attributed to the seller as an admin action | Low integrity/UX | **FIX_BEFORE_ACTIVATION** with automated source-bound evidence and actor-kind semantics |
| SystemAuditLog case/cron events are absent from the admin audit page | Medium operations visibility | **DEFERRED_PRODUCT_WORK**; design a combined read-only staff timeline without granting cross-table CRUD |
| No retention policy exists and two ledgers restrict audit deletion | Medium legal/scalability | **DEFERRED_PRODUCT_WORK** pending reviewed legal retention periods; no purge in security release |
| JSON exact-reference collection may scan the audit table | Medium scalability/privacy latency | **BOUNDED_AND_PROVED** at 100,000 rows (~70 ms); repeat before one million rows or at 500 ms |
| Metadata size constraint is `NOT VALID` | Low catalog debt | **FIX_BEFORE_ACTIVATION** inventory and validate or fail closed on historical violations |
| Current indexes do not match stable page/action pagination | Low scalability | **FIX_IN_PREPARATION** after realistic plan proof |
| `LOCAL_ANONYMIZE` could complete before audit-redaction plans were durable | Historical medium privacy/recovery | **VERIFIED_FIXED**; plan enqueue and anonymization now commit or roll back together |
| Old global substring redaction corrupted unrelated rows | Historical high | **VERIFIED_FIXED** on current source; retain two-user noninterference regression |
| Old deterministic case-mark id could block a second mark | Historical medium | **VERIFIED_FIXED** in installed PostgreSQL function; fresh random suffix retained |

Only the explicitly marked deferred product items may remain open at
activation, and their future authority requirements must remain documented.

## Preparation go/no-go

**GO for isolated compatible preparation under Option B.** The domain can be
protected without a public policy or table split. Implementation must stop
before activation if any direct consumer, generic writer, unbounded deletion
scan, catalog drift, or rollback gap remains.

## Required evidence before compatible preparation is accepted

1. **Passed locally:** machine-checked source inventory proves zero direct
   delegate and raw SQL access outside the new fixed-operation module.
2. Failing-first behavior tests on current public main, then passing tests for
   staff page bounds, actor-self writes, automated listing evidence, ban
   repair, undo concurrency and deletion noninterference.
3. **Passed for preparation:** the complete 462-migration PostgreSQL 17 schema proves
   the 14 purpose-bound operations plus private trigger, exact role split,
   current/legacy redaction, atomic completion and stale-fingerprint refusal.
   The reusable inspector also seals the exact retained 23-function catalog;
   the foreign-key seal remains an activation artifact.
4. **Passed:** deterministic parallel-writer, two-session insert/deletion,
   undo/undo and undo/redaction races. Repair/repair remains part of the retained-domain
   catalog proof, not the account-redaction boundary.
5. **Passed:** 100,000-row PostgreSQL 17 plans for unfiltered and action-filtered
   staff pages plus deletion candidate collection (about 0.3 ms, 0.3 ms and
   70 ms respectively on the disposable proof server).
6. **Passed:** predecessor-app/new-database CRUD works after the additive
   migration, while the production build checks the exact runtime, staff and
   account-deletion function bodies and fails closed if the new app is built
   against the predecessor database. The app-first rollback removed only the
   15 additive functions, two indexes and trigger on PostgreSQL 17; predecessor
   CRUD then passed and the 28-row audit fingerprint was unchanged before the
   exact migration reapplied.
7. **Passed:** exact preparation migration bytes, owners, grants, volatility,
   search paths, source digests, indexes and trigger are in the reusable
   release catalog and pass a real PostgreSQL catalog readback.
8. **Passed:** durable redaction-plan creation and local anonymization are one
   transaction, with retry payloads containing only redacted patches and
   source fingerprints.
9. **Locally passed; exact CI open:** the reusable preparation workflow passed
   its exact pending, applied-unrecorded and applied restart paths with the real
   `prisma migrate resolve --applied` ledger command and mode-600 sanitized
   evidence containing no row data. The exact branch must still pass the full
   PostgreSQL 17 CI job, including the deterministic concurrency proof.

## Activation-candidate evidence

**GO for isolated activation review; not authorized for Production.** The
separate `20261102020000_activate_admin_audit_log_rls` candidate combines
policyless `ENABLE` plus `FORCE`, revokes all direct runtime, isolated-staff,
account-deletion and `PUBLIC` table authority, and seals the exact 38-function
prepared/retained catalog, 12 columns, two constraints, seven indexes and the
private insert-fence trigger.

The complete 464-migration PostgreSQL 17 proof now passes from an empty
database through final runtime, staff and account-deletion role convergence.
It executes direct-denial checks, current behavior, the database-first
rollback, predecessor runtime CRUD after rollback, and exact reactivation.
The reusable production inspector also passes the local `ready` and
`active_unrecorded` states. Focused activation, release-catalog, workflow and
grant-inventory tests pass. One timing-only ReviewVote proof rejection did not
repeat; the same ReviewVote scenario passed ten strict isolated stress runs
and the next clean full-chain run passed.

Exact-branch CI, independent exact-head review, compatible application
deployment and predecessor drain, Production inventory, and Drew's separate
approval of the exact Production action remain mandatory. No merge,
deployment, Production database change or RLS activation is authorized by
this evidence.
