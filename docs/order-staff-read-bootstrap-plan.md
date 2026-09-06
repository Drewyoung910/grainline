# Order staff-read login bootstrap

Status: isolated, dormant bootstrap core and local journal adapter; not an
executable production operator.
Prepared from the green PR #430 head
`fa94c89fc09239ecfed8510d188e0aace4b8b436` (CI `34010014880` succeeded).
No role, password, provider variable, grant, deployment or production data was
changed while preparing this code.

## Implemented boundary

`scripts/order-staff-read-role-bootstrap.mjs` provides the SQL transaction,
private-state validation, recovery sequence and shared read-only catalog reader.
It has no CLI, credential-file loader or provider adapter. Imports do not run it.

- Generate one 256-bit password, a separate attempt UUID and a SCRAM verifier.
  Persist the private credential and exact release/CI binding before SQL.
- Create only `grainline_staff_read_runtime`, with LOGIN, NOINHERIT,
  NOBYPASSRLS and no elevated role attributes. Send only the existing reviewed
  SCRAM builder's verifier in SQL, never the plaintext password.
- Bind the role comment to the attempt and release. Serialize cooperating
  creation transactions with one transaction-scoped advisory lock and bounded
  statement/lock timeouts.
- Reuse only an existing role with that exact marker. Never adopt an unbound
  role, reset an existing password, repair grants or drop a role automatically.
- Abort and roll back creation if role attributes, membership, ownership,
  default grants or effective public-schema application authority are wrong.
  The only optional incoming membership is the already-reviewed non-effective
  `cloud_admin` to `neondb_owner` bootstrap edge.
- On ambiguous SQL failure, preserve `create-pending` with the same credential.
  A replay cannot replace the existing password. Require fresh separate-login
  possession, marker, role and database checks before recording `role-verified`.
- A terminal-state replay performs no creation SQL but repeats authentication
  and the engine-enforced repeatable-read read-only catalog proof.
- Return only sanitized status/binding flags. Provider error causes are not
  rethrown because they may contain credentials or SQL.

The bootstrap grants neither the two staff functions nor application-table
access. Ordinary PostgreSQL built-in capabilities such as CONNECT/TEMP are not
described as zero privileges; this proof concerns restricted role posture and
zero public-schema application authority. The compatible-prefix scope proof
still owns function identities, ownership, migration bytes and table posture.

PostgreSQL stores valid pre-encrypted SCRAM verifiers directly; plaintext SQL
passwords can enter command/server logs. This is why the existing verifier
builder is reused: [CREATE ROLE documentation](https://www.postgresql.org/docs/current/sql-createrole.html).

## Tests and limits

Unit tests exercise intent-persistence failure, ambiguous SQL outcome, final
persistence failure, immutable release/credential binding, separate-login
identity/authority failures, terminal replay and secret-free evidence/errors.
Disposable PGlite executes the actual SQL and shared catalog query, including
PUBLIC privilege rollback, same-role replay, preserved verifier, marker refusal,
attribute/membership/default-grant/ownership drift and column/definer leakage.
The test intentionally models the owner as a fixture superuser; it is a SQL
proof, not a Neon hook or real network-login proof. PR #430's separate real
PostgreSQL 16 grant-convergence proof remains a distinct accepted predecessor.

Sharing the catalog query initially exposed a PL/pgSQL variable/table-alias
collision (`candidate.oid`); the disposable proof rejected it. Distinct
`existing_role` and `proof_snapshot` variables corrected it before any push or
production execution. The test requires the exact expected rejection, so an
unrelated SQL error cannot masquerade as a successful security denial.

Local validation of code checkpoint
`9c8bc182e02947a8afa12acd2fa3a17affb649f9` passed: ten focused tests,
TypeScript, targeted lint including the otherwise ignored script, and the full
suite (4,234 total; 4,223 passed, 11 skipped, zero failures). No production
adapter, CI dispatch or provider execution was added. This checkpoint lives on
`agent/order-staff-read-bootstrap-20260906`; PR #430 remains unchanged.

## Private restart journal

`scripts/order-staff-read-bootstrap-journal.mjs` now supplies the local
persistence boundary. It has no production path, credential loader, provider
adapter or executable entrypoint. Its caller must supply an existing canonical
owner-only directory; the production release adapter must still pin and verify
the exact ignored location before it can be used outside disposable tests.

- Exclusive mode-0600 lock creation prevents cooperating concurrent attempts.
  Directory ownership/mode, canonical path and inode are checked; private files
  reject symlinks, hardlinks, nonregular files and group/world access.
- State writes use exclusive mode-0600 pending files, file fsync, readback,
  atomic rename, directory fsync and final readback before returning to SQL.
  File contents, attempt, credential and exact release/CI binding cannot change
  during a held session; stages only repeat or advance one step.
- A persistence failure poisons that adapter instance. SQL cannot follow an
  uncertain intent write. A retained callback cannot write after releasing its
  lock. Provider errors and malformed private JSON are not echoed.
- Ordinary error unwinding releases only the exact owned lock. A process crash
  leaves the lock in place. A stranded pending file or lock is a recovery stop,
  not permission to adopt it, generate another password or delete it by age/PID.
  Recovery must establish the prior process is gone and reconcile the exact
  private attempt and database marker before a separately reviewed recovery
  action removes any lock or chooses between pending and committed state.

Tests cover the journal integrated with the bootstrap core, immutable attempt
and credential binding, forbidden stage transitions, competing holders, unsafe
paths/files, state replacement, stranded writes, and a real SIGKILL child-process
crash. Injected file-fsync, rename and directory-fsync failures all prevent SQL
and preserve the relevant restart files. No production credential is used.

This protects cooperating local operators and accidental filesystem mistakes;
it is not a sandbox against malicious processes already running as the same
OS user. Filesystem fsync/rename semantics are assumed; the process-crash test
does not prove arbitrary hardware/power-loss durability. No network filesystem
or automatic stale-lock recovery is supported by this preparation.

Local journal-pass validation: nine new journal tests passed, targeted lint and
TypeScript passed, and the complete suite passed (4,243 total; 4,232 passed,
11 skipped; zero failures). Full sanitized test output is retained locally at
`/private/tmp/grainline-staff-bootstrap-journal-full-20260906.log`; these durable
counts do not depend on preserving that disposable log. This is local evidence,
not a new GitHub CI result or production-login attestation.

## Remaining production-adapter gate

Before this can be invoked outside tests, implement and review an adapter that:

1. pins exact merged source, successful CI and the reviewed production endpoint,
   database, owner identity, current credential epoch and unchanged deployment;
2. pins a fixed ignored private directory and connects the tested journal
   adapter above to the bootstrap core; prove Git excludes the entire directory
   and retain the fail-closed stale-lock/pending-write recovery boundary;
3. connects only through the reviewed direct owner URL and a fresh separately
   authenticated pooled staff client, enforces strict TLS/channel-binding URL
   parameters and rejects ambient connection overrides;
4. rolls back or discards an owner connection after a failed transaction; never
   leaves a failed transaction in a reusable pool;
5. completes actual PostgreSQL 16 login/restart/concurrency transport coverage;
6. stages a separately bounded sensitive Production
   `ORDER_STAFF_READ_DATABASE_URL` installation with metadata attestation and
   explicit handling of an ambiguous provider write; and
7. requires the scoped production authorization before mutation.

Do not infer that a sensitive Vercel value can be read back. A successful API
response/metadata observation is not proof that an application can authenticate;
that boundary must be demonstrated through the subsequently deployed client.
Do not use a generic credential-recovery operator: this release must not rotate
the existing owner/runtime credentials or deploy an application as a side effect.

Next implementation pass: bind live exact-main/CI/target observations to the
reviewed release and compose the direct-owner/fresh-staff connection adapter.
Reuse existing URL parsing, but do not mistake
`assertDeterministicPostgresEnvironment` for a complete environment allowlist:
it currently checks `PGOPTIONS` and disabled TLS verification only. The adapter
must explicitly exclude other ambient connection overrides as required above.

Release order remains: authority-free login and isolated secret; compatible
Order prefix; exact two-function grant convergence; separate-login proofs;
application deployment and authenticated smoke; exact predecessor drain; then
the separately verified RLS activation. See
`order-zero-direct-compatible-packaging-plan.md` and `order-staff-read-authority.md`.
