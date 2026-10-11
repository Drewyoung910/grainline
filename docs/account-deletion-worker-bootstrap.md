# Account deletion worker bootstrap

Last updated: 2026-10-11

## Scope

This package prepares a restricted PostgreSQL login and one separately bounded
Vercel Production environment-variable installer for the
`AccountDeletionSideEffect` worker. Importing the modules is inert. The source
package does not create the role, install a credential, apply SQL, deploy the
application, move an alias, or enable or force RLS.

The exact login is `grainline_account_deletion_runtime`. It must be `LOGIN`,
`NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, and
`NOBYPASSRLS`, with zero application authority before the preparation
migration. The owner adapter binds the private password as a transaction-local
parameter and PostgreSQL hashes it with `password_encryption = 'scram-sha-256'`.
Neither the password nor a client-built verifier enters client SQL text.
Dynamic role-creation failures are caught and replaced by a generic error so
the expanded server-side statement cannot escape through an uncaught error.

## Private inputs and restart state

Production entrypoints use only the fixed root
`/Users/drewyoung/grainline/.env.account-deletion-worker-bootstrap`. The
directory must be owned by the current user with mode `0700`. Every contained
file must be a regular, single-link, owner-only mode-`0600` file.

The fixed inputs are:

- `release.json`: canonical JSON binding the reviewed release commit, merged-main
  CI, TLS proof job, deployment, canonical aliases, the still-current owner
  recovery evidence, the later runtime-credential rotation evidence, and their
  deterministic composite credential epoch;
- `provider-tokens.json`: canonical JSON containing only the GitHub and Vercel
  provider tokens;
- `account-deletion-bootstrap.json`: the immutable attempt identity and secret,
  whose stage can move only from `prepared` to `create-pending` to
  `role-verified`;
- `account-deletion-bootstrap.pending`: a durable same-attempt write pending
  atomic rename;
- `account-deletion-bootstrap.lock`: an exclusive active-run lock. A stale lock
  is preserved for review and is never stolen automatically.

The role marker is
`grainline:account-deletion-bootstrap:<attemptId>:<releaseCommit>`. An ambiguous
retry must reuse the exact journaled credential. An existing role without the
exact marker and posture fails closed.

The credential epoch is deliberately composed from two fixed mode-`0600`
records. The 2026-09-02 recovery record still proves the current owner
credential. The 2026-09-28 runtime-rotation result proves the current pooled
`grainline_app_runtime` credential, the rejection of its predecessor, the
unchanged owner credential, and denial of direct table reads. The manifest pins
each file by SHA-256 and pins a deterministic digest of that exact pair. A
runtime rotation cannot be admitted by reusing the older combined record.

## Independent admission

The operator admits only an exact clean checkout whose HEAD and remote main are
the reviewed commit, a successful first-party merged-main CI run, and the
successful `tls-login` job from
`.github/workflows/account-deletion-worker-bootstrap-proof.yml`. It independently
resolves the reviewed Production deployment and every canonical alias and
requires all aliases to resolve to the reviewed deployment ID. It also pins the
completed database-credential recovery evidence digest and rechecks the release
before and after each live mutation.

The disposable TLS proof requires a fresh connection using verified TLS and
`SCRAM-SHA-256-PLUS`. Cleartext, MD5, ordinary SCRAM without channel binding,
and trust-only readiness are rejected.

## Separately authorized operations

Role creation and proof require the exact confirmation:

```text
create-and-verify-account-deletion-authority-free-login-only
```

The separate Vercel installer requires:

```text
install-account-deletion-production-database-url-only
```

The provider step may create only `ACCOUNT_DELETION_DATABASE_URL` as a
sensitive Production variable in the reviewed Grainline project and team. Its
value uses the same Production database through the pooled endpoint, the exact
restricted role, `sslmode=verify-full`, and `channel_binding=require`. A
conflicting existing row fails closed. An exact attempt-bound row is accepted
on retry after independent inventory, including when the original provider
response was ambiguous. Provider response bodies are URL, content-type, redirect,
size, and schema bounded before use.

Vercel environment changes affect later deployments. Installing the variable
therefore precedes candidate deployment and does not alter the currently
running application by itself.

## Release order

1. Merge this source package and accept exact merged-main CI and the independent
   TLS proof.
2. Create the fixed private directory, canonical manifest, and provider-token
   file; retain only the externally reviewed manifest digest in the command.
3. Separately authorize and run the role bootstrap. Preserve its sanitized
   receipt and private journal.
4. Separately authorize and run the Vercel environment installer. Preserve its
   sanitized receipt and independently re-read the single sensitive Production
   row.
5. Separately authorize and apply only preparation migration
   `20261011170000_prepare_account_deletion_side_effect_claim_fence`.
6. Deploy and validate the worker while the legacy helpers remain compatible,
   then drain predecessor work.
7. Separately authorize and apply activation migration
   `20261011180000_enable_account_deletion_side_effect_rls`.
8. Treat FORCE RLS as a later release boundary with its own inspection and
   authorization.

The receipts contain identity, digests, stage, and status only. They must not
contain passwords, database URLs, provider tokens, raw provider payloads, or
owner SQL.
