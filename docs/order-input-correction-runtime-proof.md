# Order input corrections — disposable runtime-login proof

Status, 2026-09-07: isolated CI proof implementation; native PostgreSQL CI
acceptance pending. No production workflow, migration, deployment, credential
or provider change is authorized or performed by this work.

## Boundary being proved

The three input-correction drafts replace five function bodies. Their prior
PostgreSQL 16 proof attests exact application and rollback as the disposable
owner, not visibility or execution through an actual runtime login. This proof
closes that narrower login gap without pretending it is a fresh authenticated
application/provider smoke or the final production pooled-runtime postflight.

`scripts/order-input-correction-runtime-postgres-proof.mjs` accepts only a
loopback PostgreSQL 16 `grainline_ci` template under `ci`, with no connection
override parameters. It verifies the complete unchanged candidate first,
refuses an existing `grainline_order_input_runtime_proof` database, then copies
the disposable template into that exact child. All draft DDL commits happen
only in the child so a second connection can see them. The parent keeps its
historical catalog and ledger.

The runtime role must have the expected restricted flags and a NULL password
before setup. A deliberately non-secret CI-only password is installed
temporarily. A distinct connection authenticates as `grainline_app_runtime`;
both `CURRENT_USER` and `SESSION_USER` must agree. The proof never substitutes
an owner connection with `SET ROLE`. Through that login it checks all five
corrected source hashes and runs:

- malformed NULL/empty/unknown/whitespace input rejection for label outcomes,
  ambiguous refund reason, reconciliation action and provider disposition;
- NULL notification type rejection through the real commerce wrapper;
- denial of direct private Notification-core execution and non-read-column
  updates, plus the unchanged SELECT/UPDATE(read) privilege and FORCE-RLS
  posture and zero visible rows without recipient context;
- five valid-domain absence controls: missing seller/claim/receipt source and
  retained ADMIN-only reconciliation behavior.

The call matrix has 23 malformed-input/private-access denials plus two
expected authorization/state denials among its five absence controls. It runs
inside a read-committed transaction that is rolled back. It creates no fixtures
or provider objects and requires all missing-source identifiers to be absent
before starting. These controls do **not** claim successful label purchase,
refund effects or receipt creation; those legitimate lifecycle tests remain
in the existing historical/corrected engine suites and the fresh route smoke
remains a production release gate.

## Teardown and failure behavior

Close the runtime and child-owner connections; restore and verify the runtime
password is NULL; drop only the child created by this invocation; verify its
absence; and rerun the unchanged parent prefix proof. There is no forced
database drop or backend termination. If any teardown action fails, attempt
the remaining independent cleanup actions and fail the run. Never overwrite
an existing role password or remove a preexisting child. A creation failure
with an ambiguous connection result is not retried or counted as cleaned up;
the disposable Actions service is destroyed by runner teardown.

Only bounded stage/SQLSTATE diagnostics and sanitized success counts are
printed. Connection strings, function catalogs and provider secrets are not
logged. All shared-role mutation is confined to the disposable CI service;
the URL, database, login and server identity checks forbid a production target.

## Validation record and next gate

Local tests cover target rejection, actual-login identity checks, preservation
of the parent, and injected teardown failures. An offline Prisma-schema-to-SQL
fixture in PGlite executes the same call matrix: it fails against historical
guards and passes against corrected functions. This is not a native-login or
complete-migration proof. Its first local run caught a missing distinct related
user in the valid receipt control; the fixture was corrected without changing
the source's recipient rule. The six focused runtime-proof tests then passed.

Native PostgreSQL 16 CI runs this operator immediately after the accepted
owner composition proof. After exact-head CI acceptance, package the input
successors with their chronological migration/ledger checks. Keep the
independent reservation-repair release separate. Do not weaken historical
postflight source pins or call this proof production activation.

After Drew resumed solo implementation, the combined draft/runtime focused
suite passed 11/11. Teardown injection now also covers owner/controller close
failures, a password that remains installed despite a successful reset command,
and a child still present after a successful drop command. Every such failure
must remain a failure while independent cleanup continues. Target rejection
also covers protocol, fragment and duplicate/override query parameters. The
first resumed full suite passed 4,368 tests with 13 skips and no failures.
The final expanded candidate repeated that result (4,381 total, 4,368 passing,
13 skipped, zero failed); lint, TypeScript and whitespace checks also passed.
Native CI acceptance still requires a new exact-head run.

## Failed first native run and corrected read contract

Run `34177187482` at `0e737b000bd0b0909bf88d16b3a5a0dd21ecaf02`
passed actual runtime login/source checks, then failed at `runtime-input-boundaries`.
The proof incorrectly expected a direct Notification SELECT to raise `42501`.
Notification deliberately retains SELECT plus column-only UPDATE(read), with
recipient filtering and FORCE RLS. Its original activation SQL, current grant
provisioning and production postflight already agree on that contract. The local
fixture had omitted those grants, so its passing result did not catch the mismatch.
The coarse failure stage does not distinguish every call; exact corrected native
acceptance is still required before saying all runtime controls passed.

The correction changes no migration, policy, table/function grant or application
behavior. It checks a genuine forbidden title update, attests unchanged read
privileges and active FORCE RLS, and requires zero rows without recipient context.
The local engine fixture now reuses the real migration's policy/grant section and
contains a foreign recipient row. It reproduces the old incorrect expectation,
passes the corrected boundary, and fails when a permissive policy exposes that
row. Unit checks additionally reject every posture/context drift. The separate
source-only/rollback proof remains unchanged. Sanitized per-call phase names make
any subsequent failure attributable without logging database rows or secrets.

The focused combined proof suite passed 12/12. The corrected full suite passed
4,369 tests with 13 skips and zero failures (4,382 total); lint, TypeScript,
syntax and whitespace checks passed. The preserved staff-page RED draft initially
hit Next's lint rule for a local variable named `module`; it was renamed and lint
rerun, without changing the reproduction or enabling any application fix.
Native exact-head CI remains the acceptance gate.

At the failed native checkpoint, companion account-deletion concurrency
`34177187441`, paid-repair locking `34177187449` and staff-bootstrap
`34177187464` all passed. They do not override the failed main CI or attest the
later corrected input-proof revision.
