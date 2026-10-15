# Database full-chain harness

This directory is the first tracked port of the disposable database harness
that was developed during the October 2026 audit. It preserves the reusable
parts of that work without preserving a generated database cluster, package
installation, output logs, credentials, or machine-specific paths.

## What is tracked

- `tools/database-full-chain/scenarios/migration-chain.mjs` discovers every
  checked-in Prisma migration, hashes the original bytes for the Prisma ledger,
  records the two known CI-engine deviations, and applies the ordered chain
  through an injected database adapter.
- `tools/database-full-chain/scenarios/psql-script.mjs` implements only the
  psql meta-commands present in Grainline's four CI role scripts. The paired
  `ci-role-scripts.mjs` module bootstraps the disposable roles, retries grant
  convergence at migration boundaries, and limits the staff fallback to
  functions that already exist.
- `tools/database-full-chain/scenarios/seller-profile-private-fixture.mjs`
  verifies the post-retirement seller layout before seeding. It inserts only
  public fields into `SellerProfile`, requires the initializer to create
  `SellerProfilePrivate`, then writes private provider and shipping state only
  to the private table.
- `tools/database-full-chain/postgres16/adapter.mjs` accepts an existing
  `pg.Client` connected as `ci` to a loopback `grainline_ci` database. It keeps
  real `CONCURRENTLY` statements outside a multi-statement implicit
  transaction.

The migration runner deliberately requires `bootstrapRoles` and
`convergeRoles` callbacks. Use `createCiRoleScriptCallbacks()` for the normal
disposable path. Keeping these callbacks explicit lets later CI integration
wrap the exact staged release ordering without silently producing a database
with the wrong grants.

```js
const roles = createCiRoleScriptCallbacks();
const summary = await applyFullMigrationChain({
  adapter,
  repositoryRoot,
  engine: "postgres16",
  bootstrapRoles: roles.bootstrapRoles,
  convergeRoles: roles.convergeRoles,
});
await seedSellerProfilePrivateFixture(adapter);
```

The caller creates and closes the engine connection. No helper reads a local
environment file or chooses a database URL on the caller's behalf.

## Safety boundary

This source is a disposable-test library, not a Production operator. The
PostgreSQL adapter accepts loopback hosts only, database `grainline_ci`, owner
`ci`, and PostgreSQL major version 16. Callers supply credentials at runtime;
no URL or password belongs in this tree.

The PostgreSQL 16 plan records one source-preserving deviation:

1. Migration `20260905180000_correct_order_banned_buyer_completion` has four
   reviewed `neondb_owner` literals. The disposable CI copy replaces those four
   literals with `ci`, while the ledger keeps the original file checksum.

Every deviation fails closed if the expected source shape changes.

Two historical activation migrations need role scripts to converge immediately
before their first successful application. The runner retries only these exact
refusals:

- `20260801194000_enable_direct_upload_rls` when the cleanup lease function's
  reviewed owner or ACL has not converged;
- `20260927090000_enable_order_rls` when the staff-function authority is not
  ready.

Every other migration error fails immediately. A SQLSTATE or message change at
either reviewed boundary also fails instead of broadening the exception.

The main CI job runs this harness against its real `postgres:16` service before
the rest of the database suite. It then recreates the disposable `grainline_ci`
database so the existing Prisma migration and behavior suites still start from
a blank database. Before later release tests move migration directories aside,
CI preserves a source-only copy under `RUNNER_TEMP`; the harness unit tests use
that copy so they continue to verify the complete plan during the normal test
step. The harness test skips in ordinary local `npm test` runs when
`DATABASE_FULL_CHAIN_PROOF_DATABASE_URL` is absent; that skip is not acceptance.
The passing PostgreSQL 16 CI step is the acceptance evidence.

## Intentionally deferred from Claude's preserved scratch tree

The following remain preserved under
`.claude/preserved-audit-harness-20261014` and are not copied into tracked
source in this first pass:

- generated PGlite snapshots, PostgreSQL data directories, result logs, schema
  dumps, node_modules, and package-install state;
- the broad exploratory and race suites under `agents/pgreal`,
  `trigger_sweep`, `flows_money`, `flows_social`, and `flows_catalog`;
- issue-specific stand-ins such as `standin_651.mjs` that modify database
  functions in memory;
- the old baseline-versus-current runner and generated comparison output;
- the account-deletion flow scripts that still depend on scratch-relative
  imports.

The post-retirement seed source in `agents/regress_a343` was reviewed while
building `seller-profile-private-fixture.mjs`. Its full source and checksums
remain in the preserved tree for later scenario-by-scenario ports. Additional
flows should be ported one scenario at a time when their risk justifies the
extra full-chain behavior coverage.
