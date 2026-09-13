# DirectUpload legacy-reference repair

Status: production legacy-reference repair complete on 2026-07-28.
Compatibility-key retirement and DirectUpload RLS activation have not run in
production.

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

The first disposable replay (`30392993364`) failed closed while Prisma masked
the underlying SQL error as an aborted transaction. The workflow was hardened
to isolate the repair after the compatible baseline and execute its exact bytes
with `psql --echo-errors`. Diagnostic replay `30393161851` then identified a
schema-qualified PostgreSQL parser special form:
`pg_catalog.position('..' IN upload.key)`. No production or persistent staging
state changed. The repair now uses bare `position`, and the repository-wide
special-form guard rejects that qualification class going forward. Corrected
PostgreSQL 16 run `30393344198` then passed the exact SQL replay, both
aggregate-valid repair partitions, compatible authority proof, disposable
retirement/activation proof and rollback with zero persistent-state change.

The production mutation required:

1. focused and full local tests, TypeScript, lint, migration replay, grant audit
   and PostgreSQL proof must pass on the exact clean repair commit;
2. GitHub CI and the focused PostgreSQL workflow must pass at that exact commit;
3. the production-migration guard must pin the full migration-tree digest with
   this repair as the latest migration and must reject retirement/activation
   candidates;
4. a fresh aggregate preflight must still match the repair boundary, including
   valid active owners, using `pre-repair-inspection` and exact confirmation
   `inspect-prelaunch-direct-upload-legacy-state`;
5. create and verify a recoverable Neon backup/child branch before mutation;
6. dispatch the protected production migration workflow for that exact main
   commit only;
7. run the protected aggregate-only inspector in
   `post-repair-verification` mode with exact confirmation
   `verify-prelaunch-direct-upload-legacy-repair`, proving 2 active
   references, one-or-two normalized claimed uploads, one-or-two delayed
   verified uploads, zero unknown claim labels, valid active owners and
   unchanged RLS/grant posture.

Only after repair evidence is durable may the separate compatibility-key
retirement and DirectUpload FORCE-RLS activation sequence resume. The repair
does not authorize either later step.

## Production repair completion — 2026-07-28

PR `#66` merged the reviewed data-only repair at exact main commit
`9bda3509b4dd371c469e6a694c6b6a0ac5af6a83`. Pull-request CI run
`30393989837`, focused PostgreSQL run `30393987193`, and merged-main CI run
`30394252961` passed the exact migration tree, both valid repair partitions,
authority/rollback proof, migration replay, grant audit, TypeScript, lint,
2,189 repository tests (2,186 pass, zero fail, three intentional skips),
dependency audit and production build.

Fresh protected pre-repair inspection run `30394541893` (job `90394116644`)
then passed in one repeatable-read, read-only owner transaction at that exact
main commit. In addition to the previously inspected 3/0/2 boundary, the
strengthened operator proved zero missing, banned or deleted lifecycle owners.
The mode-0600 sanitized off-worktree artifact is
`direct-upload-legacy-pre-repair-inspection-9bda3509b4dd371c469e6a694c6b6a0ac5af6a83.json`;
its SHA-256 is
`ad172adece521e4560febdf41e5c82b580e654667eb2a990e6502517777ed6db`.

A protected, compute-less Neon child was created before mutation:

- branch id `br-late-night-aaghw6ow`;
- name `direct-upload-legacy-repair-backup-20260728-2005z`;
- production parent `br-hidden-mouse-aaugn2wr`;
- parent LSN `0/4B8C9578`;
- parent timestamp `2026-07-28T20:05:34Z`;
- ready, protected, non-primary, non-default, with zero compute endpoints.

The initial create call completed at Neon but its immediate local response
validator rejected the returned shape. The operator did not retry. A
read-only inventory found exactly one branch with the intended name, and
separate project/parent/branch/endpoint reads proved the complete boundary
above. Retain this branch through the later activation rollback window.

Protected production migration run `30394920532` (job `90395347308`) applied
only `20260726185700_repair_direct_upload_legacy_references` at exact main
`9bda3509b4dd371c469e6a694c6b6a0ac5af6a83`. Its source/owner/role guard,
exact-tree guard, prior RLS release proofs, migration status and live final
grant/RLS audit all passed.

Protected post-repair verification run `30395029352` (job `90395714093`) then
passed read-only at the same commit. Production landed in the distinct-upload
partition:

- 3 lifecycle rows remain;
- exactly 2 active references bind 2 `CLAIMED` uploads;
- the unmatched third upload is `VERIFIED`, has no claim metadata and is
  behind the seven-day cleanup fence;
- 0 released references, invalid owners, unknown claim labels, dangling or
  mismatched references, backfillable sources, cleanup-eligible rows, Case
  attachments, external/UTFS URLs or unrepairable lifecycle rows;
- the 120 historical first-party durable URLs without lifecycle rows remain
  deliberately untracked; the repair created no synthetic lifecycle rows;
- `DirectUpload` RLS remains off with compatible legacy runtime CRUD;
  `DirectUploadReference` remains policyless ENABLE plus FORCE with no runtime
  table authority.

The mode-0600 sanitized off-worktree postflight artifact is
`direct-upload-legacy-post-repair-verification-9bda3509b4dd371c469e6a694c6b6a0ac5af6a83.json`;
its SHA-256 is
`57f6fbb42e879ee5c06a11433088c8edbb929c631f4f0733c29cfb6d55669a2a`.
No application deploy, provider-object mutation, compatibility-key retirement,
cleanup-worker activation or DirectUpload RLS activation was part of this
repair release.
