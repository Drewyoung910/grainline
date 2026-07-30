# Case invariant production release

Status: invariant-only candidate. The migration is committed for review but
has not been merged or applied to production. Case, CaseMessage and
CaseMessageAttachment RLS remains off.

## Exact scope

The release contains exactly one new migration:

- `20260730010000_enforce_case_message_invariants`
- migration SHA-256:
  `4557c044740a6cee0d30b78ebe1d9bb300b43613cf979fba01d2571e3c4d1fa1`
- complete reviewed migration-tree SHA-256:
  `91815465852a6ce8aafbd05ac3a6775925da5303284360b71d6f84f3a20f3b64`

`scripts/stage-case-invariant-migration.mjs` derives the migration from the
byte-pinned draft
`docs/rls-drafts/case-case-message-invariants.sql` (SHA-256
`a9b0a944f071717cda64c56b92050ef9fe696ca6b9e5b04750831ce14da42eb7`).
The generator rejects source drift, an existing destination, any Case-family
RLS/policy/table-grant statement, and catalog-count drift. Staging or
unstaging requires the explicit acknowledgement plus a loopback
`grainline_ci` URL; verification is read-only and needs no database.

The migration:

- freezes all three protected tables before rechecking every legacy shape;
- adds and validates six row constraints;
- makes `CaseMessage.authorKind` non-null;
- installs eight runtime-private trigger functions, split into five
  cross-table `SECURITY DEFINER` functions and three row-local
  `SECURITY INVOKER` functions;
- installs nine triggers, including two deferred opening-evidence triggers;
- revokes trigger-function execution from both `PUBLIC` and
  `grainline_app_runtime`; and
- changes no RLS flag, policy, table/column grant, application source, row
  payload or provider setting.

The read-mode, ENABLE, rollback, FORCE and FORCE-rollback SQL remains
draft-only under `docs/rls-drafts/`.

## Accepted prerequisites

The invariant candidate builds on these already-verified production
boundaries:

- compatible Case database preparation at exact main
  `4728f673fdf0a11d38aaac384f3d9afe2cf86117`;
- protected Production Migrations run `30511805499`, which applied only that
  compatible preparation;
- the mode-0600 pooled-runtime postflight evidence at
  `grainline-rollout-evidence/case-compatible-database-production-postflight-4728f673fdf0a11d38aaac384f3d9afe2cf86117.json`,
  SHA-256
  `3003f96d3b74a3805ecbb0b82671f0cc52134d84ba326ce92ac5a1a0f628ff64`;
- compatible Case application merge
  `f2f6861b177a47d22ed304714372584b79a0a0b0`;
- exact-main CI run `30512956823`, job `90776727905`; and
- production Vercel deployment
  `dpl_Gvsge8MWYW8DfDRSom34YPwsY8rH`, which serves the production aliases
  with `CASE_EVIDENCE_ATTACHMENTS_ENABLED` absent and therefore disabled.

The application scanner reports zero ordinary direct Case-family access. Its
79 conversions plus one retired unused helper resolve the complete
80-reference baseline to 27 reviewed fixed operations.

## Engine proof

The source design passed PostgreSQL 16 at exact head
`b9f2e40c530c06787afee1cb776010f853f5f7d4`, GitHub Actions run
`30504119117`, job `90750043124`. The 54-check rollback-only proof covered
legacy preflight rejection, all constraints and triggers, source binding,
lock/race behavior, the five-DEFINER/three-INVOKER partition, policyless
ENABLE, direct runtime denial, all fixed operations, FORCE, rollback and zero
residue.

That disposable result proves the reviewed design but does not replace the
fresh exact-head CI required for this promoted migration.

The first promoted exact-head CI run, `30514664290` (job `90781719972`),
successfully applied the migration and converged runtime grants, then failed
closed in the older participant-resolution proof. That harness had inserted
each Case and its opening CaseMessage in separate autocommit transactions, so
the new deferred opening-evidence trigger correctly rejected the temporarily
empty Case. The proof seed is now one explicit transaction with rollback on
failure. This was disposable CI only; production and persistent staging were
unchanged.

The next exact-head CI run, `30514921138` (job `90782496635`), confirmed the
participant-resolution repair and the buyer Case-open proof, then failed
closed in the older Case-reply fixture for the same reason: it created Cases
without durable opening messages. A class-wide audit found the same
pre-promotion fixture assumption in later Case proof harnesses. The repair
updates only disposable proof seeding and cleanup: every directly seeded Case
now lives in an explicit transaction, has one exact `OrderItem` seller
relationship, has durable opening evidence from a valid participant, and
uses a valid terminal lifecycle shape. The Case-message page proof also
retires its synthetic null-`authorKind` rows because the promoted migration
makes those rows impossible. A central static inventory now fails if any of
the ten post-migration proof fixtures drops atomic seeding, exact seller
evidence or opening-message evidence. No policy, authority function,
application path, migration byte or production state changed in this repair.

Exact-head CI run `30515681220` (job `90784835276`) then reached the repaired
Case-reply proof and rejected one non-OPEN fixture whose
`discussionStartedAt` preceded its synthetic `createdAt`. The fixture now
models a Case opened two hours earlier and discussion started one hour
earlier, while preserving the same authority assertions. A focused static
regression test records that clock ordering. This was another disposable
fixture-only failure; the promoted migration, application, production and
persistent staging remained unchanged.

The first attempted repair at `25938c05e8b70ca456c2936e12f253d4247d5c5a`
matched an earlier identical timestamp pair in the seller-profile seed rather
than the Case insert; exact-head CI run `30516019868` (job `90785894074`)
correctly repeated the same failure. The corrected assertion first isolates
the `seedCase` function body, preventing unrelated matching text from
satisfying it. The stray seller-profile timestamp change was reverted.

Exact-head CI run `30516379280` (job `90787078906`) confirmed the Case clock
repair and reached the reply side-effect assertions. Those predated durable
opening evidence and counted every CaseMessage, so the opening row made an
expected one generated reply appear as two messages. The three side-effect
counts now exclude the known opening-message ID while retaining their
original assertions: one attachment reply, two distinct replay-test replies,
and zero reply/attachment residue after rollback. The fixture compatibility
guard requires all three exclusions.

Exact-head CI run `30516516364` (job `90787495312`) passed the complete
Case-reply proof and every proof through the Case-aware Order check, then
rejected the seller-aggregate proof's recent Case clock. That harness began a
transaction, later constructed `createdAt` from the JavaScript wall clock,
and paired it with PostgreSQL `CURRENT_TIMESTAMP`, which remains fixed at the
earlier transaction start. The fixture now derives `updatedAt` as the greater
of those two values. A class audit found no other direct fixture combining a
post-BEGIN JavaScript Case clock with an earlier database transaction clock.

The Extra-High promoted-SQL review then found that
`Case_resolution_shape_check` rejected an empty refund provider ID but not a
whitespace-only value. Both the legacy preflight and durable check now use
`pg_catalog.btrim`, and the rollback-only engine proof adds an explicit
`blank_refund_provider_evidence` rejection as check 55. This security
strengthening changed only the still-unapplied invariant draft/candidate and
their exact hashes; production remained unchanged.

Exact-head CI run `30516967241` (job `90788887464`) passed the promoted
migration, runtime-role convergence and every Case authority/invariant proof,
including the strengthened 55-check rollback-only proof. It then stopped at
the repository-wide grant audit because that older source-derived contract
still classified every newly discovered `grainline_*` function as a runtime
RPC. The migration and provisioner correctly withhold runtime/PUBLIC EXECUTE
from all eight owner-internal Case trigger functions; granting EXECUTE would
weaken the reviewed boundary. A shared Case-invariant function catalog now
drives the production postflight and the global runtime-private audit
classification, with a regression assertion requiring all eight names to
remain private. This was disposable CI only; production and persistent
staging were unchanged.

The invariant-only merge landed on main as
`67c3c35ea505296cc6c5c7890dae7c2f06ea95f8`. Exact-main CI run
`30517469491` passed the complete repository, disposable PostgreSQL and
production-build gates. The standing Notification FORCE proof run
`30517469486` then correctly rejected its pre-invariant fixture because that
proof created a Case and opening message in separate autocommit transactions.
A class-wide follow-up found the same latent fixture assumption in both
DirectUpload authority proofs and found that the Case lifecycle reset helper
omitted durable opening evidence and complete refund evidence. The compatible
repair keeps each direct Case seed atomic, supplies exact OrderItem seller
evidence and author kinds, and extends the fixture inventory guard across all
13 direct SQL Case proof harnesses plus the Prisma lifecycle helper.
Production has not received the invariant migration.

The first repair-branch reruns advanced past the missing-opening failure.
Notification run `30518041404` then exposed incomplete synthetic refund
evidence, while Case lifecycle run `30518044102` exposed an ambiguous Prisma
nested-write ordering at the message-author trigger. The repair now gives
Notification refund fixtures a positive amount and nonblank provider ID, and
models lifecycle creation explicitly as Case then CaseMessage inside the same
transaction. DirectUpload run `30518042854` already passed its complete
compatible, activated, concurrency and rollback program at exact repair head
`4da1fab56c999f8c33269d87c9f5d84408359018`.
The next exact-head runs proved those repairs and exposed two more clock/kind
fixtures at the invariant itself: an opening message reused a timestamp captured
before its parent Case existed, and Notification changed a message author
without changing the matching author kind. The harness now lets PostgreSQL
timestamp the opening message after the Case insert and never rewrites message
authority fields.
Live PostgreSQL then correctly rejected both author-field mutation and deleting
the only human opening message ahead of its parent. Notification now seeds
separate immutable buyer, seller and staff messages, while lifecycle cleanup
deletes the parent Case and relies on its declared cascade for messages.
The lifecycle run subsequently reached historical-state construction and
rejected Cases whose synthetic discussion or response clocks predated their
default creation clock. `resetCase` now derives a deliberately earlier fixture
creation time from every supplied lifecycle clock.
The next live pass reached the participant-resolution race and exposed a stale
proof model: it always left the Case `PENDING_CLOSE`, even when the second
participant confirmed resolution. The proof helper now mirrors the fixed
authority function by atomically producing `RESOLVED` plus `DISMISSED` and
resolution provenance when both participant marks are present; a following
reply is expected to fail closed.
The first execution of that branch also confirmed PostgreSQL cannot infer a
timestamp parameter through a mixed `CASE` expression; the proof now casts the
resolved clock explicitly to the table's timestamp-without-time-zone type.

## Production postflight contract

After a separately reviewed main merge and protected migration run, execute:

`npm run ops:case-invariant-postflight`

with only the reviewed pooled production `DATABASE_URL` and
`CASE_INVARIANT_POSTFLIGHT_CONFIRM` equal to
`verify-production-case-invariants-read-only`.

The postflight rejects privileged/alternate database variables, non-pooled or
wrong endpoint/role/database URLs, session-role overrides and weakened TLS. It
opens `BEGIN TRANSACTION READ ONLY`, has PostgreSQL attest
`transaction_read_only=on`, verifies the exact table/constraint/function/
trigger catalog and the five/three execution-mode partition, proves the
runtime role receives `42501` for all eight trigger-function calls, then
rolls back. It creates no fixture and exports no row.

## Required next sequence

1. Pass exact-head PostgreSQL CI and the complete repository gates.
2. Merge this invariant-only release.
3. Run exact-main CI.
4. Apply only this committed migration through the protected Production
   Migrations workflow.
5. Run and retain the sanitized pooled-runtime read-only postflight.
6. Promote the four-function read-mode convergence as a separate compatible
   migration.
7. Activate policyless ENABLE with FORCE still off as a separate release.
8. Complete authenticated route and pooled-runtime denial proof.
9. Apply posture-only FORCE in the final Case release.

Do not combine read-mode, ENABLE or FORCE with this invariant release.
Orders, payments and shipping remain the next independently audited sensitive
group after Case FORCE is complete.
