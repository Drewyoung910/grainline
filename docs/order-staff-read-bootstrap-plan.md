# Order staff-read login bootstrap

Status: isolated, dormant bootstrap core; not an executable production operator.
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

## Remaining production-adapter gate

Before this can be invoked outside tests, implement and review an adapter that:

1. pins exact merged source, successful CI and the reviewed production endpoint,
   database, owner identity, current credential epoch and unchanged deployment;
2. exclusively locks a fixed ignored private journal, rejects symlinks/foreign
   ownership, uses mode-0600 atomic writes and fsync, and reads back the exact
   persisted state before allowing SQL;
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

Release order remains: authority-free login and isolated secret; compatible
Order prefix; exact two-function grant convergence; separate-login proofs;
application deployment and authenticated smoke; exact predecessor drain; then
the separately verified RLS activation. See
`order-zero-direct-compatible-packaging-plan.md` and `order-staff-read-authority.md`.
