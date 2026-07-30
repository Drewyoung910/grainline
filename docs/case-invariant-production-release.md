# Case invariant production release

Status: invariant-only candidate. The migration is committed for review but
has not been merged or applied to production. Case, CaseMessage and
CaseMessageAttachment RLS remains off.

## Exact scope

The release contains exactly one new migration:

- `20260730010000_enforce_case_message_invariants`
- migration SHA-256:
  `85aa6826f50d5af0be938fd455e7d42999e6715e40bdf7b4c864416d9191d8e8`
- complete reviewed migration-tree SHA-256:
  `1e553c9e8253f25ef1c6a0bd4eff64c4ed154343500ad9d1f0bf0ed707ee1dad`

`scripts/stage-case-invariant-migration.mjs` derives the migration from the
byte-pinned draft
`docs/rls-drafts/case-case-message-invariants.sql` (SHA-256
`08d635abe68a2a3b0bd926989d579ad3f339825ac7a33508085e1d792b259393`).
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
