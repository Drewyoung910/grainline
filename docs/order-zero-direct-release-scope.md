# Order compatibility prefix: dormant release scope

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

## Still required before production execution

This is **not the complete production validator or runner**. Every verdict says
`completeProductionScope=false` and `productionExecutionAuthorized=false`.

The next implementation must finish
serialized fresh-scope and selected-file execution fencing, exact-main CI and
loaded-source binding, and the existing final global audit. Credential-incident
acceptance remains a separate gate. Do not dispatch the historical 18-member
Order workflow, remove its latest-migration guard, or reuse this partial result
as approval to execute.

The prefix reader accepts only completed migration-prefix states. It does not
infer that every migration is atomic: member 10 has no enclosing SQL BEGIN.
An interrupted or partially applied member must fail closed for separate
inspection; this component does not resolve failed rows or replay partial DDL.

Then retain the separate correction boundaries, Case readers-before-SQL and
label-clock-before-retry dependencies, staff credential/grant/login acceptance,
matching app deployment and authenticated provider smoke, predecessor drain,
and Order ENABLE/FORCE postflights. No production workflow is wired by this pass.
