# Order compatibility prefix: dormant release scope

Current source behavior is recorded in [Dormant admitted execution composition](#dormant-admitted-execution-composition--september-12).
The earlier dated sections retain component history and superseded remaining-work notes.

## Persistent worker successor — September 9

`order-zero-direct-release-worker.mjs` now owns a persistent child with one
canonical checkout/cwd. Its inline bootstrap verifies the reviewed Node 22
binary/version and fixed source-fence bytes before any repository import,
then verifies the complete tracked checkout. The parent retains only a bounded
IPC transport; release modules, connections, scope observations and opaque
artifact handles stay in that child. The worker has no CLI or mutation command.

The protocol deliberately separates four steps:

1. `prepare()` accepts no credentials. It refuses an existing dependency tree,
   ignored files (including local environment files), or project npm config;
   exclusively claims the dedicated checkout; runs the 1 GiB disk guard; and
   performs `npm ci --ignore-scripts --include=dev` with private home/cache/temp
   directories and separate empty user/global npm configs. Explicit Prisma
   engine download and client generation follow, with engine version and
   generated-client presence checks. No release graph is loaded at this stage.
2. `load({ci, githubToken})` takes an already-held token after preparation has
   finished, runs the existing exact-main CI collector, reverifies source and
   installed identities, and imports the actual release graph in this process.
   Node resolution hooks reject ancestor `node_modules` fallback for preparation
   tools and the loaded graph. Clearing NODE_PATH alone would not prevent it.
3. `inspect(...)` reobserves a running exact manual main workflow/job under the
   existing shared `production-database-migrations` concurrency group and
   `cancel-in-progress: false`. An exclusive per-run/attempt host claim prevents
   competing workers within the same admitted run. Fresh source/CI checks precede
   a new dedicated owner connection with default read-only transactions and the
   existing engine-enforced audited reader. Admission is checked again after
   asynchronous reads, then the existing file fence stages the exact prefix.
4. `revalidate(...)` uses fresh admission, CI and a new audited connection again;
   rejects a changed prefix; and rereads source, installed identities and the
   retained artifact. It returns bounded observations, never the client,
   credentials, raw catalog or transferable artifact handle.

All environment settings are deliberately supplied. Parent credentials, Node
preloads, module paths, proxies, custom trust roots and Prisma engine/mirror/
checksum overrides are excluded. Node and npm CLI/version pins must be supplied
from a reviewed toolchain artifact; local proof-derived pins are not production
approval. The external npm distribution and host remain trusted. A clean
lockfile installation establishes package provenance; an in-process filesystem
identity snapshot detects subsequent installed-tree drift. This is not a new
portable directory attestation, nor protection against a compromised runtime or
hostile same-user process. Engine/client generation is explicitly checked rather
than inferred from package-lock metadata.

An exit, timeout, protocol error, stale scope, source/dependency drift or lost
admission fails closed. Checkout and admission claims are never automatically
stolen or reclaimed. Private bounded status checkpoints and partial artifacts
are retained for inspection; a new worker needs a new clean checkout and fresh
admission. These preparation records are not a crash-recovery migration journal.
The parent kills the worker process group on close/failure so installation
children cannot outlive a discarded worker. Idle workers expire after ten minutes.

GitHub observations are not an independent cryptographic lease: actual global
serialization is supplied by the reviewed workflow's concurrency contract and
trusted job lifecycle. The worker checks its continuing validity on each scope
operation; no serialized success object can resume a dead worker. This code does
not wire or dispatch a workflow, and the historical workflow is still unsuitable
for executing this prefix. A future invocation must run inside its separately
reviewed successor job, with current operational authorization.

Protocol tests use real child processes and temporary Git checkouts, with
explicit fixture installers/engines/graph and mocked GitHub reads. They exercise
ordering, same-process state, worker exit/restart, competing preparations and
admissions, missing engines/client, changed source/dependencies/artifacts,
ancestor resolution, lost admission, stale scope, unknown/partial prefixes and
the complete-prefix final obligations. These fixture scenarios do not repeat or
replace the accepted native SQL proofs. Real clean-install preparation is a
separate local check recorded in the private checkpoint.
That integration check also loaded the actual release graph with real installed
packages in the same persistent worker, using an explicit in-memory GitHub
transport fixture. It passed installation, generation, graph loading and repeat
verification. It is not a live exact-main/CI observation or a database proof.

During that real preparation check, npm rejected using `/dev/null` for both
config files; they are now distinct empty private files. The installed Prisma
fetch-engine package also does not expose `download` as a Node synthetic named
export; explicit default CommonJS imports now match the real package. Neither
failure changed historical verifiers, package versions or migration bytes.

**Remaining executable boundary:** bounded prefix application, reviewed grant
convergence, migration status and final global/read-only scope must still be
composed into a separately reviewed mutation path and proven in disposable
PostgreSQL. This worker exposes no `execute`, `migrate`, grant-write or failed-row
resolve operation. Even prefix 17 retains all final convergence/audit steps.
Every response preserves `completeProductionScope=false` and
`productionExecutionAuthorized=false`. Exact-head CI, credential-incident
acceptance and all deployment, runtime/staff, provider, overlap, ENABLE and FORCE
gates remain distinct.

The sections below retain the accepted predecessor component history.

September 8, 2026. Source-only successor to the accepted correction release
package at `f00eac52611bed629d741157839cc31e3e710b61`, CI `34247688283`.
That package requires 251 predecessor migrations. This component covers the
17-member September 5 prefix needed to reach that state; it does not assume
production already has it and does not reopen the accepted six-draft proof.

## Implemented boundary

`scripts/order-zero-direct-release-scope.mjs` validates the unchanged, byte-pinned
source catalog, requires the complete 234-migration baseline, and admits only
the contiguous 0–17 applied prefix. The same three reviewed historical ledger
exceptions are retained through the unchanged historical validator. Unknown,
missing, duplicate, failed, rolled-back or checksum-drifted rows are rejected,
except those exact historical exceptions. The six later correction candidates
are excluded, not opportunistically admitted.

The schema/role successor is accepted at `d750b6eb` / CI `34276777170`:
4,476 CI tests passed, nine skipped, no failures; all three companion workflows
passed. Its native proofs confirmed 38 schema records and ten drift denials.
Do not repeat that accepted block as pending. The next isolated successor below
adds global-audit composition; it needs its own exact-head acceptance.

Each of the 18 states binds the exact current subset of 36 affected functions:
typed OID identity, body SHA-256, owner, language, SECURITY DEFINER, search path,
return/argument metadata, volatility/parallel safety, runtime execution and
explicit ACLs. Argument modes use `text[]` for native node-postgres decoding.
Fixed `timestamp(3)` declarations normalize to PostgreSQL's typmod-free function
identity. This is a narrow parser of hash-attested sources, not a general SQL
parser or an admission mechanism for arbitrary migrations.

Order must remain an ordinary owner-held table with RLS/FORCE off, no policies,
exact ordinary-runtime CRUD, and no extra table/column or staff authority.
`OrderStaffCapability` appears at member 10 and
`SellerDeauthorizationApplication` at member 12, both policyless FORCE tables
without runtime or staff access. All ten private target functions remain
unavailable to ordinary runtime; all staff execution remains dormant. The later
six-operation staff grant boundary is deliberately excluded.

The September 8 structural successor adds a committed 38-record schema catalog:
17 columns, 11 constraints, five indexes, one trigger and four relation-shape
records. Exact source DDL is independently replayed into offline fixtures;
expected definitions are never learned from the database being admitted.
Member 3 requires the validated provider-claim exclusion, member 10 introduces
the exact staff capability table, member 11 introduces the bounded JSON source
snapshot, and member 12 introduces typed deauthorization fields and the immutable
application table. Checks must be validated; index definitions, validity and
ownership, defaults, typmods and trigger binding/state must match. Private
tables have complete column/constraint/index/trigger inventories. Existing
Order and CheckoutStockReservation schema checks cover the selected additions,
not every historical column. CheckoutStockReservation must also retain its
policyless FORCE posture and no ordinary-runtime or staff table/column access.

The same read-only snapshot now checks owner/runtime/cleanup role attributes,
and the staff role if present, before reading the migration ledger. Restricted
logins cannot have outbound memberships. In production only the exact
non-effective `cloud_admin`-granted owner bootstrap edges are admitted; recursive
inbound paths reject other members, including paths through the owner. The
existing owner `neon_superuser` option contract is preserved (its grantor is not
newly pinned). Disposable mode requires `ci` and no relevant membership edges;
it does not map a superuser into a successful production-owner proof. This is
role attribute/membership verification, not credential-incident acceptance,
role-configuration, global default-ACL/ownership or actual-login proof.

The reader requires a **fresh dedicated connection with no active transaction**.
It owns one repeatable-read read-only transaction, checks engine transaction
settings and exact session/current role/database before ledger/catalog reads,
and ends with ROLLBACK on success or failure. It has no credential loader,
connection constructor, CLI, migration writer or provider calls. The returned
plan is data: completed members are not replayed, and final convergence, migration
status and global audits remain required even at prefix length 17.

## Global authority composition successor

`readAuditedSnapshot` adds the existing `auditLiveDatabase` to the **same**
engine-read-only snapshot after the exact ledger/function/schema/role checks.
`readSnapshot` remains the narrower historical component; it cannot establish
the new `assertAuditedSnapshot` contract without a valid global attestation.
The latter binds the exact prefix, expected inventory SHA-256, zero issue count
and configuration result. Neither authorizes execution or removes the final
post-convergence global audit.

The adapter derives 18 stage-specific inventories from fixed source: only the
not-yet-created affected functions and two named private tables are removed.
Every unaffected table, enum, function and RLS disposition stays in scope. The
complete prefix is exactly the legacy audit's unmodified full inventory: 67
tables and 265 functions. Independent tests reconstruct each source prefix in
an owned disposable directory and compare the legacy-derived expectations;
the complete source's REVOKE diagnostic text is retained, while its actual
default-privilege requirements must equal each staged source's requirements.
No general missing-object suppression is added to the historical audit.

Configuration checks read only aggregate counts for applicable owner/runtime/
cleanup/staff and database-wide overrides. No such overrides are declared by
the reviewed provisioning scripts. Any existing override, including benign
timeouts, therefore needs separate inspection and an explicit reviewed contract;
the checker does not clear it or silently learn it from production. Raw GUC
values may be secrets and are not returned. Effective catalog search order must
be pg_catalog then public, standard-conforming strings and row security must be
on, replication mode must be origin, and the transaction must remain
repeatable-read/read-only. Credential/session authenticity and application
identity proofs remain separate.

Native CI uses the audited reader after the real 251-migration tree, plus
rollback-only negative global grants, an unexpected function, default ACL and
configuration overrides. Earlier inventories are source-tree tested, not claimed
as 18 fully replayed native production catalogs. Ordinary-runtime global audit
coverage is inherited unchanged; this is not blanket credential-incident,
provider, staff-login or arbitrary historical-schema acceptance.

Local successor validation: 19 focused tests passed; full suite 4,477 passed,
13 environment-dependent skips, zero failures or cancellations (4,490 total).
TypeScript, repository lint, and explicit lint of the changed scripts/tests
passed. The emitted lint dependency warning did not fail the command. Native
PostgreSQL acceptance remains pending this successor's exact-head CI; record
that outcome on the draft PR and recovery checkpoint without a docs-only CI loop.

## Evidence and limits

Focused tests cover every restart state and every predecessor's deletion,
duplication, checksum and status drift; gap and cross-release rejection;
function bodies/metadata/authority; and retained table access. PGlite tests run
the actual catalog reader through all 18 states and inject real public column
grants, table grants, staff/function grants, policies and RLS drift. Those are
catalog-only fixtures with minimal predecessor tables, actual selected DDL,
modeled historical ledger and database name;
function bodies are not executed and missing referenced app tables are explicit.

Ordinary CI additionally runs
`scripts/order-zero-direct-release-scope-postgres-proof.mjs` after all 251 real
migrations and runtime grant convergence. Its URL admission accepts only the
loopback `ci` / `grainline_ci` service. It reads actual PostgreSQL catalogs with
the production driver and real CI identity inside the engine-read-only
transaction; only the fixed historical ledger exceptions are modeled in memory.
It writes no ledger rows or database state. This is not a production observation
or an actual ordinary-runtime/staff login proof. Exact-head acceptance belongs
on draft PR #432 and the local recovery checkpoint after checks finish.

The separate disposable-only structure proof applies ten negative schema/role
changes plus six global-authority/configuration changes (16 expected denials),
each in its own rolled-back transaction, with exact catalog restoration
and a final engine-read-only audited complete-prefix check. An extra unrelated Order
column is a deliberate out-of-scope control, not falsely reported as covered.
No application rows, credential values or ledger rows are changed. This negative
fixture proof is distinct from the mutation-free release reader. Native
PostgreSQL 16 CI must accept the committed schema rendering; offline PGlite 17
success alone does not attest driver/version parity.

The initial local schema test exposed a fixture-only restoration issue:
re-parsing `pg_get_constraintdef` can move array casts in the expression tree.
The verifier was not loosened. Negative tests roll back to the original source
DDL instead of treating regenerated equivalent SQL as the original catalog.

## Dormant selected-file fence

`scripts/order-zero-direct-release-files.mjs` is the filesystem component, not
a migration runner. It derives its allowlist from the existing fixed release
catalog, classifies the supplied ledger using the unchanged completed-prefix
rules, and stages only 251 exact migration files plus the pinned PostgreSQL
lock file. All historical and already-applied files are retained for Prisma
status/history consistency; `remainingMigrations` identifies only the unapplied
contiguous suffix. At prefix 17 it is empty, not permission to skip final audits.
The six later correction candidates cannot enter this artifact.

The source and staged trees require exact directory/file inventories and byte
hashes. Canonical paths, no-follow descriptor reads, regular-file/single-link
checks, bounded reads and descriptor/path identity checks reject links, aliases,
missing/extra files and detected changes during reading. Staging creates a fresh
directory in a caller-owned mode-0700 parent outside the source tree; it never
overwrites or deletes existing artifacts. Files become mode 0400 and directories
0500. Errors preserve any private partial artifact for inspection. This is not
a crash-durable journal or a guarantee against a hostile same-user/privileged
host process; filesystem modes do not establish an execution trust boundary.

Artifact handles are immutable and private to their creating fence instance.
`verify(handle)` rereads the source and staged trees and checks the private
parent before use; copied, forged or cross-instance handles are rejected.
It performs no database access and cannot attest that supplied ledger rows were
fresh or authentic. The future serialized controller must obtain the actual
audited snapshot after lock admission, bind the complete loaded source/toolchain
and exact-main CI, and revalidate selected files immediately before execution.
This component deliberately returns false for fresh database scope, loaded
source/CI proof, complete production scope and production execution authority.
It contains no credential loader, child-process command or production CLI.

Focused filesystem tests exercise all 18 restart states, exact file-byte
preservation, suffix selection, partial member-10 rejection, source/staged
drift, symlink and hard-link substitutions, unsafe parent permissions, isolated
handles and separate artifacts. An initial macOS fixture could not rename a
read-only directory; the negative test now explicitly changes only its owned
fixture directory permissions before simulating substitution. The verifier's
read-only mode requirement was not relaxed.

## Still required before production execution

### Dormant tracked-source boundary

`order-zero-direct-release-source.mjs` reads a canonical checkout using a fixed
Git executable and isolated Git environment. It binds an explicitly supplied
reviewed commit, exact Grainline origin, clean index/worktree, and every tracked
regular file to its committed Git blob and a SHA-256 catalog. It rejects
index-hidden entries, configured Git filters before status can execute them,
unsupported symlinks/submodules, executable-mode drift,
hardlinks, ancestor aliases and byte changes. Reads have per-file/total bounds
and before/after descriptor checks. `verify(handle)` repeats the observation;
handles cannot be forged or transferred between instances. The component
imports only Node built-ins and invokes only read-only Git commands.

This is disk-source identity, not loaded-process identity. Ignored files,
including installed dependencies, are deliberately not attested. Local origin
metadata is not authenticated remote-main/CI evidence. Capturing hashes after
another module was imported cannot prove its cached bytes. Sequential reads
are not an atomic filesystem snapshot or protection against a hostile same-user
process. A future fresh-process bootstrap must bind the actual loaded source,
installed toolchain and independently authenticated exact-main CI, and repeat
checks immediately before execution under serialization. Consequently this
component explicitly returns false for loaded source, installed toolchain,
authenticated CI, complete production scope and execution authority. It neither
loads credentials nor executes release code, Prisma or provider operations.

This is **not the complete production validator or runner**. Every verdict says
`completeProductionScope=false` and `productionExecutionAuthorized=false`.

### Dormant exact-main CI collector

`order-zero-direct-release-ci.mjs` binds a separately reviewed commit, source
catalog digest, CI run ID and run attempt. It captures the tracked-source fence,
reads the exact Grainline GitHub main ref and CI run twice, and reverifies the
checkout before returning. Both reads must show the same reviewed main commit
and completed successful push/main `.github/workflows/ci.yml` run from the same
repository, including head repository and exact run attempt. Changed main,
reruns, mismatched workflows, unsuccessful results and checkout drift fail.

The collector accepts an already-held token but never loads one. Requests are
fixed-origin GET-only, reject redirects and alternate TLS/proxy configuration,
use bounded JSON reads and timeouts, and return only sanitized binding fields.
It has no CLI, dispatch, database or release-execution path. Tests use real
temporary Git checkouts and mocked HTTP responses; they are not live GitHub
attestation or production evidence. Local origin metadata alone is not used as
remote acceptance. Returned observations are not a transferable authorization
capability and must not be accepted from an arbitrary caller by a future runner.

This check is time-bounded evidence, not a lock on GitHub main or CI: either can
change after the last read. Fresh collection remains required at admission and
before execution. Loaded module bytes, installed dependencies, fresh database
scope and serialization remain separate unproven boundaries, with execution
authority still explicitly false. No production collector was run in this pass.

The next implementation must finish
serialized fresh-scope and selected-file execution fencing, exact-main CI and
loaded-source binding, and the existing final global audit. Credential-incident
acceptance remains a separate gate. Do not dispatch the historical 18-member
Order workflow, remove its latest-migration guard, or reuse this partial result
as approval to execute.

### Fresh-process source probe, not a migration worker

`order-zero-direct-fresh-source-probe.mjs` launches a new Node process using only
a fixed bootstrap and the reviewed commit, source catalog, source-fence hash,
Node version and Node-binary hash. Pins must come from reviewed release/toolchain
evidence; computing them from an arbitrary current installation is not production
acceptance. The parent and child check the runtime binding. Before importing any
repository module, the child checks the fixed source-fence file against its pin;
it then captures and reverifies the complete tracked checkout. No arbitrary
entrypoint, shell command, database credential, npm dependency or migration
module is accepted or loaded by this probe.

The child gets only fixed PATH, UTC and C locale settings, not the parent's
credentials, proxy, NODE_PATH or NODE_OPTIONS. On macOS the OS-added
`__CF_USER_TEXT_ENCODING` entry is allowed only in its hexadecimal descriptor
shape. An initial native test rejected that OS-added entry; the exception does
not permit preload or credential variables. Child execution has a timeout and
bounded output; errors are sanitized. Real child tests prove distinct processes,
preload/credential exclusion, changed-file rejection before import, incorrect
pins and dirty-source denial.

The returned probe is not a worker session or reusable execution capability.
It proves only this fresh source-fence import and checkout check; it deliberately
leaves `loadedReleaseGraphProven`, `installedToolchainProven`, complete scope and
production authority false. It does not load the 78-module release graph, `pg`,
TypeScript, Prisma or generated engines. A subsequent process cannot inherit
this process's loaded-code claim. The trusted-host assumption remains explicit:
these checks do not protect against a hostile same-user process racing files
or an already-compromised parent/runtime. No production entrypoint is wired.

The prefix reader accepts only completed migration-prefix states. It does not
infer that every migration is atomic: member 10 has no enclosing SQL BEGIN.
An interrupted or partially applied member must fail closed for separate
inspection; this component does not resolve failed rows or replay partial DDL.

Then retain the separate correction boundaries, Case readers-before-SQL and
label-clock-before-retry dependencies, staff credential/grant/login acceptance,
matching app deployment and authenticated provider smoke, predecessor drain,
and Order ENABLE/FORCE postflights. No production workflow is wired by this pass.
# Disposable bounded execution candidate

The persistent worker now has an `executeDisposable` command, available only
after its clean installation and graph load. It admits numeric loopback,
`ci` / `grainline_ci`, PostgreSQL 16 and a verified disposable superuser. There
is still no production execution command or production workflow wiring.

The shared executor stages only the 251 reviewed history/prefix migrations,
records durable intent before Prisma deploy, then reinspects the complete
prefix. It converges exactly the 36 reviewed function identities, runs Prisma
status against the same selected artifact, repeats the unchanged global audit,
and obtains final read-only scope. Entry at prefix 17 skips only deployment.
Prisma receives a private fixed config and scrubbed environment; module
resolution stays inside the checkout except for that exact config and builtins.

The private execution journal uses exclusive mode-0600 files, file/directory
fsync and atomic state replacement. An uncertain command, failed grant
transaction, lost guard or process exit preserves the last intent and claim.
Do not delete that claim, overwrite its state, automatically retry, run
`migrate resolve`, or mark a partial member complete. Inspect the retained
artifact/journal and obtain a fresh audited ledger in a separately reviewed
attempt. Failed or partial member 10 remains inadmissible. These records
contain binding digests and stages, never connection strings or database rows.

The CI proof prepares a real persistent worker in a separate clean checkout,
with fresh dependencies and explicit test pins. Only the GitHub CI transport is
replaced by an identified local fixture for the successful attempt. An earlier
separate fixture injects SIGKILL after durable apply intent and before spawning
Prisma; its retained journal/claim must survive. A new fixture worker performs
a fresh native prefix-zero inspection and applies all 17 members to
the disposable PostgreSQL baseline using the same executor and adapter; the
harness then exercises already-complete entry. Its
historical ledger normalization models only the three sealed exceptions;
padding rows are removed before classification. This CI harness uses local
source observations, not reviewed production pins or production admission.
Unit tests isolate orchestration and failure injection; PGlite checks the exact
function-grant partition. Native CI acceptance must be recorded separately.
This pre-command crash does not prove recovery from an in-flight database
command or a partially executed member 10; those native drills remain separate.

Production execution still requires the completed live admission/worker
composition and operational authorization. Credential incident acceptance,
matching application deployment, staff/provider/runtime evidence, predecessor
drain, Order ENABLE and Order FORCE remain separate gates.

## Native interrupted-migration recovery candidate

The recovery harness adds a separately pinned fixture that installs a private
event trigger after initial native scope and durable apply intent. It pauses
member 10 at `CREATE TABLE OrderStaffCapability`; an independent controller
binds the waiting backend's PID, start time and query digest before terminating
that connection. The reviewed migration files are unchanged. A real incomplete
Prisma ledger row must remain and the worker's apply intent must survive.

PostgreSQL fires `ddl_command_end` before commit, so termination can roll the
DDL back. The proof records whether native partial DDL remained. If none did,
it explicitly models one committed first statement in the failed database,
leaving the actual failed ledger unchanged. A newly prepared worker must then
refuse that incomplete ledger/catalog before creating a migration artifact or
execution journal. This is not automatic `migrate resolve` or replay.
The exact native failed database is copied to
`grainline_order_executor_interrupted` before that additional fixture mutation.
See [PostgreSQL event-trigger behavior](https://www.postgresql.org/docs/16/event-trigger-definition.html).

Before failure, the CI-only controller clones the verified `grainline_ci`
baseline. After refusal, it verifies both database OIDs/ownership and absence
of active sessions, then transactionally renames the failed original to
`grainline_order_executor_failed` and the baseline copy to `grainline_ci`.
The failed database, ledger and private intent records are preserved. There is
no database DROP or database/owner identity translation in the scope reader.
The normal fresh native application must still validate restored prefix zero.

A separate complete-prefix attempt loses its source-guard callback during the
actual grant transaction. An independent monitor verifies PostgreSQL reports
that transaction as aborted and its journal remains at grant intent. The
callback failure is modeled; this does not establish live GitHub admission
loss or production workflow serialization during mutation. Native CI acceptance
for these new drills must be recorded separately from the previous checkpoint.

## Dormant admitted execution composition — September 12

The prepared worker now constructs a private one-attempt executor from its
loaded scope/file graph and live admission, CI, source and installed-toolchain
checks. There is no production IPC command, CLI, credential loader or workflow
wiring. The public protocol still exposes only disposable execution. A new
attempt clones and freezes its admission, CI and credential context before any
await; a caller cannot substitute a different run, attempt or URL midway.

A lifetime watch observes admission at least once per one-second scheduling
interval while asynchronous work is pending and imposes a 30-second deadline
on each observation. Concurrent checks of the same bound context join one
observation, including scope/owner reads, so claim creation cannot race itself.
Checks of a different context cannot join. A failure poisons the lifetime and
terminates the worker process group, including its command children. Closing
the watch joins an outstanding observation; late failure cannot be discarded
as success. These are bounded observations on a trusted host, not an atomic
distributed lease; synchronous work and OS scheduling can delay timers.

Fresh engine-read-only snapshots govern staging and every subsequent scope
check. Grant convergence opens a separate bounded connection and verifies
`neondb` / `neondb_owner` for both current and session identity, with writable
transactions observed without changing role/default settings. Every grant
query has checks before and after its await. Rollback and disconnect remain
available after admission loss. A failure after COMMIT is ambiguous and retains
grant intent; it must never be described as a proven rollback or automatically
replayed. The fixed Prisma adapter is shared with the disposable native proof,
retaining its scrubbed environment, exact-config import exception, command/
output limits and joined heartbeat. The unchanged executor still requires
selected-prefix deployment, all 36 grant identities, status, global audit and
final scope; prefix 17 skips only deployment.

Tests use the real manifest, staged files, journal and executor with explicitly
modeled admission/catalog/command observations. Fresh-process fixtures exercise
the worker's private capability through a fixture-only dispatcher, reject a
runtime-owner substitution and prove admission, CI and actual host-claim loss
kill a waiting worker and its child. The actual dispatcher rejects that test
command. Separate real-subprocess tests check Prisma environment isolation,
external module rejection, cancellation and late-check joining with a fake CLI.
None of these fixtures establishes live production GitHub admission, a native
production-owner login, or operational authority. Native CI must separately
accept the shared adapter change on the exact candidate; earlier native recovery
acceptance and its modeled historical/partial-DDL limits remain preserved.

After source acceptance, the next boundary is a concrete reviewed invocation
contract and separately authorized production workflow/operator integration,
including credential-incident acceptance. Core Order is finished only after
the compatible release and correction/staff/application sequence, authenticated
checks, predecessor drain, ENABLE/direct-grant revocation, and FORCE with owner
and runtime evidence. OrderItem and OrderShippingRateQuote remain separate.
