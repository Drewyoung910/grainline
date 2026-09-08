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

The reader requires a **fresh dedicated connection with no active transaction**.
It owns one repeatable-read read-only transaction, checks engine transaction
settings and exact session/current role/database before ledger/catalog reads,
and ends with ROLLBACK on success or failure. It has no credential loader,
connection constructor, CLI, migration writer or provider calls. The returned
plan is data: completed members are not replayed, and final convergence, migration
status and global audits remain required even at prefix length 17.

## Evidence and limits

Focused tests cover every restart state and every predecessor's deletion,
duplication, checksum and status drift; gap and cross-release rejection;
function bodies/metadata/authority; and retained table access. PGlite tests run
the actual catalog reader through all 18 states and inject real public column
grants, table grants, staff/function grants, policies and RLS drift. Those are
catalog-only fixtures with modeled schemas, historical ledger and database name;
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

## Still required before production execution

This is **not the complete production validator or runner**. Every verdict says
`completeProductionScope=false` and `productionExecutionAuthorized=false`.

The next implementation must compose the exact role/membership and global
authority checks, complete schema/constraint/trigger state per restart point,
serialized fresh-scope and selected-file execution fencing, exact-main CI and
loaded-source binding, and the existing final global audit. Credential-incident
acceptance remains a separate gate. Do not dispatch the historical 18-member
Order workflow, remove its latest-migration guard, or reuse this partial result
as approval to execute.

Then retain the separate correction boundaries, Case readers-before-SQL and
label-clock-before-retry dependencies, staff credential/grant/login acceptance,
matching app deployment and authenticated provider smoke, predecessor drain,
and Order ENABLE/FORCE postflights. No production workflow is wired by this pass.
