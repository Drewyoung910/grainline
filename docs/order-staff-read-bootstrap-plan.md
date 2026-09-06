# Order staff-read login bootstrap

Status: isolated, dormant bootstrap core, journal, connection adapters,
coordinator and read-only observation collectors; not an executable production operator.
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
resolved canonical aliases, and the accepted credential epoch. It also requires
the separately reviewed TLS proof run, job and run attempt on that **same main
commit**, with the correct workflow, successful proof step and successful
container teardown. Missing, skipped, duplicated, stale or cross-run job
observations are rejected. A PR proof is preparatory evidence, not a substitute
for the required main-push production admission evidence. These are pure
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

Local driver/lifecycle/release tests passed. No local PostgreSQL server or
Docker executable is available, so its normal local skip is not login evidence.
The actual PostgreSQL/TLS proof subsequently **passed in GitHub Actions** on
exact source `778b435ef0df0ec818dc3a37c908d4f27e35f87c`:
[run 34021451851](https://github.com/Drewyoung910/grainline/actions/runs/34021451851),
job `101454688066`, one passed test, zero skipped, zero failures. The service
reported PostgreSQL 16.15; both container and network teardown completed. This
accepts the disposable network proof, not a Neon production bootstrap or grant.

Preparation is in [draft PR #431](https://github.com/Drewyoung910/grainline/pull/431),
stacked on unmerged PR #430. No PR was merged and no production operation ran.
The broader source-candidate
[CI run 34021451797](https://github.com/Drewyoung910/grainline/actions/runs/34021451797)
also succeeded on exact source `778b435ef0df0ec818dc3a37c908d4f27e35f87c`:
4,254 tests, 4,246 passed, eight skipped, zero failures; all historical database
proofs, TypeScript, lint, dependency audit and the CI application build passed.
The standalone TLS result above supplies the real login evidence that the
ordinary suite deliberately skips. Preview
`dpl_BqFen1J1vUdsMyBKmqEmZMx6jhdp` was inspected: compilation and TypeScript
passed, then page-data collection failed because Preview intentionally lacks
`DATABASE_URL`. No Preview credential or configuration was changed.

Local transport/release-pass validation passed: ten focused connection/release
tests, targeted lint, TypeScript, workflow YAML parsing, and the full suite
(4,254 total; 4,242 passed, 12 skipped; zero failures). One additional skip is
the explicitly gated real TLS/PostgreSQL test. The local full-suite log is
`/private/tmp/grainline-staff-bootstrap-transport-full-20260906.log`.

### Coordinator and exact proof admission

`order-staff-read-bootstrap-coordinator.mjs` now composes the release check,
private journal, bootstrap core and fresh-connection operations. It freezes the
reviewed binding before asynchronous observation reads, checks admission before
opening the journal and again under its exclusive lock, and rejects a privately
loaded owner credential from a different attested epoch. It rechecks admission
before owner SQL, before the separate staff login and before returning a
sanitized receipt. Journal readback precedes each database operation.

If a release or alias drifts after creation, the same private attempt remains
recoverable. `role-verified` in the private journal means the role/login proof
completed, not that final release admission or secret installation succeeded;
no success receipt is returned if the final observation fails. A terminal
resume repeats admission and authentication without creation SQL. Competing
coordinators cannot load the private credential or operate under another
attempt's held journal lock.

The coordinator has no CLI, fixed production paths, credential-file loader,
provider-secret installer or grant writer. The separate read-only collectors
described below now implement its Git/GitHub/Vercel observation boundary; private
loaders and invocation remain unfinished. Injected observers and credential
loaders are trust boundaries, not self-attested production evidence. Unit tests simulate
them; the updated real TLS harness uses fabricated release metadata while
exercising the complete coordinator against its actual isolated database.

The short standalone TLS workflow now runs for every main push and PR targeting
main, including documentation checkpoints. This lets admission demand an exact
main-SHA proof without accepting historical-byte aliases. It remains independent
and parallel to the long historical migration suite. Shell preconditions reject
missing proof activation or certificate settings before Node can silently skip
the harness. Repository tests parse the workflow to enforce this boundary.

Evidence publication for this preparation: batch design/limits/next-step edits
with implementation commits; attach each subsequent exact SHA, CI run and
result to the durable [PR #431 record](https://github.com/Drewyoung910/grainline/pull/431).
Fold accepted prior-run evidence into the next source pass. Recording a green
run alone should not require another documentation-only commit and full CI wait.

Local coordinator-pass validation: ten coordinator/release tests and 26 existing
core/journal/connection tests passed; TypeScript, targeted lint and diff checks
passed. The full suite passed: 4,262 tests, 4,250 passed, 12 skipped, zero failures.
The gated real TLS test remains a local skip. The updated coordinator integration
passed on exact commit `a6f46aa62003f4ce809b4691f4c7b0701ff4257a` in
[TLS run 34023052923](https://github.com/Drewyoung910/grainline/actions/runs/34023052923),
job `101459038119`, attempt 1: one passed, zero skipped, zero failures, with
successful container teardown. Broad
[CI 34023052929](https://github.com/Drewyoung910/grainline/actions/runs/34023052929)
also passed on that same commit: 4,262 total, 4,254 passed, eight skipped, zero
failures; historical database proofs and application build accepted. Local
test output is at `/private/tmp/staff-coordinator-full.log`; these durable counts
do not depend on retaining that disposable log.

### Read-only observation collectors

`order-staff-read-bootstrap-observations.mjs` supplies real local Git reads and
fixed-origin GitHub/Vercel GET collectors. Imports perform no I/O and there is no
CLI. The reviewed binding is validated and frozen before credentials or requests;
tokens and credential-epoch observations still require separately reviewed loaders.

- Git uses a fixed executable and restricted child environment, disables hooks,
  filesystem monitors and replace objects, checks the exact repository root and
  origin, and requires a clean index/worktree including untracked files. It also
  refuses assume-unchanged and skip-worktree entries that can hide edited files.
- GitHub main is read independently before and after collection. Exact main CI,
  TLS run and TLS job come from fixed endpoints in the Grainline repository.
- Vercel queries only the reviewed deployment and four fixed canonical aliases,
  scoped to the exact team, validating project, team, READY production posture,
  deployment identity and source labels for every result. The deployment's alias
  array is not accepted instead of resolving the actual aliases.
- Requests are GET-only, refuse redirects, use bounded 15-second requests and
  two-MiB response streams, and reject alternate ambient TLS/proxy settings.
  Tokens appear only in the matching provider's authorization header, never
  argv, URLs, returned evidence or errors. Raw provider payloads (which can
  contain sensitive fields) are discarded after selecting admission fields.
- Local Git is rechecked at the end. Returned observations are deeply frozen,
  sanitized and checked by the existing release admission function before the
  coordinator can use them. A mismatched observation produces no admission.

**Source-provenance limit:** the current manual deployment was inspected through
a read-only, field-selected provider query during this pass. It is a CLI release
with a `meta.gitCommitSha` label and no `gitSource`, so requiring `gitSource.sha`
would falsely block that deployment. The collector checks the CLI label (or Git
source SHA for Git releases) against an **externally reviewed exact deployment
binding** and rejects conflicting labels. A CLI metadata value alone does not
prove uploaded build bytes. The manifest review must use accepted deployment
evidence; never generate the approved binding from the same metadata being
checked. No production deployment change was made by this inspection.

The deployment API's `url` query resolves aliases while `teamId` selects team
scope ([Vercel API reference](https://openapi-explorer.vercel.app/)). The returned
observations are bounded point-in-time reads, not a distributed atomic snapshot
or a lock against unrelated provider changes. Coordinator reattestation detects
observed drift at its boundaries; it does not prevent third-party changes.

Tests exercise all fixed requests, failure/redirect/size limits, mixed/stale
snapshots, alias moves, unsafe tokens/environment, payload minimization and
collector-to-coordinator recovery. A real disposable Git repository proves
clean/dirty/root/origin and hidden-index-flag handling. Provider responses are
simulated in these tests: the complete collector has not run using production
tokens, and credential epoch verification remains unfinished.

Local collector-pass validation: 20 observation/release/coordinator tests passed,
including ten new collector tests; targeted lint and TypeScript passed. Full
suite: 4,272 total, 4,260 passed, 12 environment-gated skips, zero failures.
The disposable log is `/private/tmp/staff-observations-full.log`. New exact-head
CI acceptance is recorded on PR #431 rather than inferred from the previous
checkpoint's successful run.

Before this can be invoked outside tests, implement and review an adapter that:

1. supplies an externally reviewed immutable release manifest (with accepted
   deployment source evidence), private provider-token loaders and independent
   credential-epoch verification to the prepared real Git/GitHub/Vercel collectors;
2. pins a fixed ignored private directory for the composed journal;
   prove Git excludes the entire directory
   and retain the fail-closed stale-lock/pending-write recovery boundary;
3. implements the fixed, mode-0600 owner credential loader with actual
   credential-epoch verification; no credential value may enter logs or argv;
4. retains the tested rollback/discard behavior and never substitutes a reusable
   owner pool or ordinary-runtime client for a separate staff login;
5. obtains successful main CI and a successful TLS run/job/attempt for the exact
   final main release. The prepared checker now enforces that binding; no
   historical proof substitution or branch-only proof is accepted for production;
6. stages a separately bounded sensitive Production
   `ORDER_STAFF_READ_DATABASE_URL` installation with metadata attestation and
   explicit handling of an ambiguous provider write; and
7. requires the scoped production authorization before mutation.

Do not infer that a sensitive Vercel value can be read back. A successful API
response/metadata observation is not proof that an application can authenticate;
that boundary must be demonstrated through the subsequently deployed client.
Do not use a generic credential-recovery operator: this release must not rotate
the existing owner/runtime credentials or deploy an application as a side effect.

Next implementation pass: wire the externally reviewed release manifest, fixed
ignored storage, provider-token loaders and private credential/epoch verification
into the prepared collectors and coordinator. Reuse existing URL
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
