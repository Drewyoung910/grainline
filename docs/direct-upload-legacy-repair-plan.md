# DirectUpload legacy-reference repair

Status: prepared and disposable-proofed only. No repair, retirement or
DirectUpload RLS activation has run in production.

## Durable production boundary

The additive DirectUpload preparation migrations were applied from exact main
commit `ff6abe15badc54132ce9df70ba56f93723d332ac` by guarded workflow run
`30389331036`. The exact-release pooled-runtime postflight passed read-only with
sanitized local evidence SHA-256
`ecef13d05cedb6ae6d815c7c5a1114f997371fceb9bf4ca1f32d041ccc467bb9`.

The compatible application from that exact checkout was then deployed as
`dpl_6amaoPXBtt84TsQ8EqrbLF5waRUk`. The production alias and `/api/health`
resolved successfully, Case evidence remained disabled, the runtime continued
to use `grainline_app_runtime`, and `DirectUpload` retained pre-activation
table CRUD with RLS off. The accepted prelaunch 300-second deployment drain
completed before inspection.

Aggregate-only inspection workflow run `30390887295` (job `90381893482`) ran
at the same exact main commit in one repeatable-read, read-only transaction.
The sanitized evidence SHA-256 is
`8592621d2b40818adec8b61c2b49f627f40aa68e9c13906def62d816e2d8200d`.
It retained no row identifiers, object keys, URLs, message bodies or
credentials.

The inspected shape is:

- 3 public `listingImage` lifecycle rows, all `CLAIMED`;
- 0 normalized references and 0 Case attachments;
- 3 obsolete/unknown legacy claim labels;
- 2 first-party durable source URLs backfillable to an existing owned
  lifecycle;
- 120 other first-party durable source URLs with no lifecycle row;
- 0 external/UTFS URLs, invalid lifecycle rows, broken constraints, lease
  anomalies or unrepairable lifecycle rows.

The two backfillable URLs do **not** prove two distinct lifecycle rows. They may
refer to one shared public upload or two separate uploads. Therefore the repair
must accept exactly two source references across either one or two lifecycle
rows and return the remaining one or two unmatched lifecycle rows to delayed
cleanup eligibility. Each backfillable source URL can match at most one
lifecycle row because the inspected rows have valid `publicUrl`/object-key
suffixes and `DirectUpload.key` is unique; duplicate durable rows for the same
source identity and URL were removed by the inspection query.

## Repair contract

Migration
`20260726185700_repair_direct_upload_legacy_references` is data-only and runs
between compatible preparation and the still-uncommitted retirement/activation
candidates. It must:

1. take the existing DirectUpload rollout advisory lock plus fixed table locks;
2. no-op only on a fresh database with zero lifecycle and reference rows;
3. accept production only at the inspected boundary: exactly 3 valid public
   `listingImage` `CLAIMED` rows, 0 references, 0 Case attachments and 3
   obsolete claim labels;
4. keep `DirectUpload` RLS off and legacy runtime table CRUD intact;
5. invoke the already-reviewed source-family functions so owner, URL, endpoint,
   source type and source id come from locked durable rows rather than legacy
   claim metadata;
6. require exactly 2 normalized active references;
7. derive canonical legacy claim metadata from those references;
8. preserve the referenced lifecycle rows as `CLAIMED`;
9. return only the unmatched one-or-two rows to `VERIFIED`, clear their claim
   metadata, and set cleanup eligibility seven days in the future;
10. create no `DirectUpload` row for any of the 120 untracked historical URLs;
11. make no RLS, policy, role, grant, provider, application or scheduler
    change.

The seven-day cleanup delay is an operational recovery fence. The compatible
cleanup worker may not immediately delete an unmatched object if the repair is
later found to need reversal or a source was unexpectedly omitted.

## Proof and release gates

The exact migration SQL is exercised in disposable PostgreSQL 16 for both
aggregate-valid partitions:

- two active references across two lifecycle rows, leaving one delayed orphan;
- two active references sharing one public lifecycle row, leaving two delayed
  orphans.

Both proofs start and end with zero disposable lifecycle/reference rows. Static
contracts reject broad lifecycle insertion, RLS/grant changes, a missing lock,
count drift, caller-derived authority, immediate cleanup or failure to cover
both valid partitions.

Before production mutation:

1. focused and full local tests, TypeScript, lint, migration replay, grant audit
   and PostgreSQL proof must pass on the exact clean repair commit;
2. GitHub CI and the focused PostgreSQL workflow must pass at that exact commit;
3. the production-migration guard must pin the full migration-tree digest with
   this repair as the latest migration and must reject retirement/activation
   candidates;
4. a fresh aggregate preflight must still match the repair boundary, including
   valid active owners;
5. create and verify a recoverable Neon backup/child branch before mutation;
6. dispatch the protected production migration workflow for that exact main
   commit only;
7. run an aggregate-only postflight proving 2 active references, one-or-two
   normalized claimed uploads, one-or-two delayed verified uploads, zero
   unknown claim labels and unchanged RLS/grant posture.

Only after repair evidence is durable may the separate compatibility-key
retirement and DirectUpload FORCE-RLS activation sequence resume. The repair
does not authorize either later step.
