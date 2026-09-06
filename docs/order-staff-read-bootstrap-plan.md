# Order staff-read login bootstrap

Status: isolated, dormant bootstrap core, journal and connection adapters; not an
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

### Prepared release and transport checks

`order-staff-read-bootstrap-release.mjs` validates a reviewed release binding
against clean exact-main Git state, successful push/main CI from the correct
repository/workflow, the unchanged READY production deployment and all four
resolved canonical aliases, and the accepted credential epoch. These are pure
checks, not live observation collectors. The actual sealed release manifest,
independent GitHub/Vercel/credential observations and their composition remain
required before any production execution. No current production state is
asserted from the test fixtures.

`order-staff-read-bootstrap-connection.mjs` now provides the direct-owner and
separate pooled-staff connection operations. It pins the reviewed endpoint,
database, role and TLS parameters, rejects ambient PG/startup/trust overrides,
uses fresh bounded clients, verifies the owner session before SQL, attempts
rollback after SQL failure, and discards every connection. The SQL and staff
password must match the same private attempt; no password replacement occurs.

Inspection of the installed `pg` driver found that `enableChannelBinding` only
prefers SCRAM-PLUS and can fall back to ordinary SCRAM. The bootstrap-specific
client therefore refuses cleartext, MD5, ordinary SCRAM, unverified TLS and
trust-only readiness; it requires a verified SCRAM-PLUS final signature before
accepting its initial ReadyForQuery. This uses narrow `pg` authentication hooks,
so dependency changes must retain the driver regression and actual TLS proof.
No application client or existing production operator was changed.

The independent `Order Staff Bootstrap Proof` workflow creates only its own
disposable PostgreSQL 16 service and test TLS certificate. The harness hardwires
every socket to loopback, runs the real connection adapter through a test-only
transport mapping, and checks committed-response-loss recovery, concurrent
same-attempt replay, rejection of a replacement password, original-password
login and terminal no-SQL replay. It models the owner as a fixture superuser,
not Neon's `cloud_admin` hook. It has no production secrets, protected
environment, workflow dispatch or deployment/migration command.

Local driver/lifecycle/release tests passed. The real PostgreSQL/TLS test is
prepared but **not yet executed or accepted**: no local PostgreSQL server or
Docker executable is available. Its normal local skip is not login evidence.
The new proof workflow must succeed on the exact candidate before release.

Local transport/release-pass validation passed: ten focused connection/release
tests, targeted lint, TypeScript, workflow YAML parsing, and the full suite
(4,254 total; 4,242 passed, 12 skipped; zero failures). One additional skip is
the explicitly gated real TLS/PostgreSQL test. The local full-suite log is
`/private/tmp/grainline-staff-bootstrap-transport-full-20260906.log`.

Before this can be invoked outside tests, implement and review an adapter that:

1. pins exact merged source, successful CI and the reviewed production endpoint,
   database, owner identity, current credential epoch and unchanged deployment;
2. pins a fixed ignored private directory and connects the tested journal
   adapter above to the bootstrap core; prove Git excludes the entire directory
   and retain the fail-closed stale-lock/pending-write recovery boundary;
3. composes the prepared connection operations with the journal and core using
   privately loaded credentials and independently attested release observations;
4. retains the tested rollback/discard behavior and never substitutes a reusable
   owner pool or ordinary-runtime client for a separate staff login;
5. obtains successful exact-candidate PostgreSQL 16/TLS login, restart and
   concurrency proof evidence from the prepared standalone workflow;
6. stages a separately bounded sensitive Production
   `ORDER_STAFF_READ_DATABASE_URL` installation with metadata attestation and
   explicit handling of an ambiguous provider write; and
7. requires the scoped production authorization before mutation.

Do not infer that a sensitive Vercel value can be read back. A successful API
response/metadata observation is not proof that an application can authenticate;
that boundary must be demonstrated through the subsequently deployed client.
Do not use a generic credential-recovery operator: this release must not rotate
the existing owner/runtime credentials or deploy an application as a side effect.

Next implementation pass: run the standalone TLS proof through candidate CI,
then compose live exact-main/CI/target observation collection and the fixed
private journal with the prepared connection operations. Reuse existing URL
parsing, but do not mistake
`assertDeterministicPostgresEnvironment` for a complete environment allowlist:
it currently checks `PGOPTIONS` and disabled TLS verification only. The new
bootstrap connection adapter explicitly rejects the other overrides; that local
hardening is not a claim about unrelated historical operators.

Release order remains: authority-free login and isolated secret; compatible
Order prefix; exact two-function grant convergence; separate-login proofs;
application deployment and authenticated smoke; exact predecessor drain; then
the separately verified RLS activation. See
`order-zero-direct-compatible-packaging-plan.md` and `order-staff-read-authority.md`.
