# Database credential exposure recovery — 2026-08-13

Status: contained; recovery operator preparation is active. No credential value belongs in this
document, a commit, a PR, an Actions artifact, or ordinary terminal output.

## Incident

After successful StripeWebhookEvent FORCE migration run `31717354633`, a local
diagnostic intended to locate database environment assignments printed two
complete PostgreSQL URLs into agent tool output:

- the production `neondb_owner` password present in ignored local owner files;
- the production pooled `grainline_app_runtime` password present in ignored
  `.env.local`.

Treat both passwords as compromised. The values were not copied into tracked
files, commits, PRs, Actions artifacts, or the planned FORCE postflight
evidence. The postflight did not connect and created no evidence file. The
isolated checkout remained clean.

The same review later requested Vercel environment JSON from a CLI version
whose output includes ciphertext fields for encrypted non-sensitive records.
Those fields are provider ciphertext, not plaintext credentials, and do not
expand the credential-rotation scope. Future inventory code must normalize
provider metadata in-process and emit only key, type, target and timestamps.

## Confirmed boundaries

- StripeWebhookEvent FORCE itself succeeded before this incident. Exact main
  `ea19fa0ace85dd61868667022c45afb3cf3218fa`, CI `31716577153`, and migration
  run `31717354633` are the production execution boundary.
- `20260810190000_prepare_checkout_stock_reservation_authority` has zero
  production migration rows and was not applied.
- No Vercel deployment, alias, environment variable, Neon role, GitHub secret,
  Stripe resource, or database grant was changed during containment.
- Current production still points at READY deployment
  `dpl_CasoctMLsvfcA1Vj2JJcNUFzXQXP` until a separately authorized credential
  recovery redeploy replaces it.

## Credential locations that must converge

Owner/migration credential:

- Neon production role `neondb_owner`;
- GitHub `Production` secret `PRODUCTION_MIGRATION_DIRECT_URL`;
- GitHub `Production` variable `PRODUCTION_MIGRATION_DIRECT_URL_SHA256`;
- ignored mode-0600 `.env.migration-owner.local`;
- legacy ignored `.env` owner URLs, which should be removed after local tools
  are proved independent of them rather than refreshed indefinitely.

Runtime credential:

- Neon production role `grainline_app_runtime`;
- sensitive Vercel Production `DATABASE_URL`;
- ignored mode-0600 `.env.local` `DATABASE_URL`.

## Reviewed recovery order

The recovery must be one restart-safe, separately authorized production
operation. Neon reset endpoints remain the password source of truth so its
stored-password vault and later reveal-based postflights stay consistent.

1. Verify exact source, clean checkout, GitHub Production protection, linked
   Vercel project, Neon production project/branch/endpoint, current production
   deployment and alias, and both current credentials without printing them.
2. Write a mode-0600 local recovery-state file containing only the prior and
   replacement secret material required for restart. Never write secrets to
   the sanitized evidence file.
3. Reset the runtime role through the reviewed Neon API and wait for every
   returned operation. Neon documents that the prior password remains valid
   until the final operation finishes and that existing compute connections
   are dropped.
4. Build the exact currently deployed source as a staged Production deployment
   with the replacement pooled runtime URL. Because Vercel environment changes
   affect only new deployments, keep it unaliased until READY. A build failure
   must stop before owner rotation and retain recovery state.
5. Promote only that READY deployment, verify canonical aliases and
   `/api/health`, then prove the prior runtime password rejects and the new
   runtime password authenticates as membership-free LOGIN/NOINHERIT/
   NOBYPASSRLS `grainline_app_runtime`.
6. Reset `neondb_owner` through Neon, wait for every operation, update the
   protected GitHub secret and digest plus the dedicated local mode-0600 owner
   file, then prove new authentication and prior-password rejection. Owner
   rotation does not require another application deployment because Vercel
   does not receive that credential.
7. Converge ignored local development to the replacement runtime URL and
   remove legacy owner URLs from `.env` after a key-only inventory proves no
   local runtime depends on them.
8. Run the StripeWebhookEvent FORCE pooled-runtime postflight from exact clean
   `ea19fa0ace85dd61868667022c45afb3cf3218fa`, bind it to CI `31716577153` and
   migration run `31717354633`, retain sanitized mode-0600 evidence, and delete
   the private recovery-state file only after every acceptance assertion.

## Restart-safe operator package

`scripts/database-credential-exposure-recovery.mjs` is the only executable
recovery path. The package is deliberately sealed in two checkpoints: the
implementation commit is reviewed first, then the release commit pins that
implementation and its own successful CI run. It rejects every other source
commit, dirty checkout, ambient PostgreSQL URL, unreviewed Neon/Vercel client,
provider identity, deployment source, GitHub run, or restart transition.

The operator records password material only in the ignored mode-0600 restart
state at `.env.database-credential-recovery-20260813.json`. Sanitized evidence
contains only hashes, roles, deployment/run IDs and boolean outcomes. A reset
response lost between provider mutation and local persistence is never replayed
blindly: the operator reveals the provider-held credential and compares it in
memory with the private restart state. Only PostgreSQL `28P01` is accepted as
proof that a superseded password rejects.

Neon has returned two URL-safe generated-password shapes for the reviewed
runtime role (16 and 64 characters); the control accepts exactly those observed
lengths while keeping every target, role and operation assertion fixed. A lost
Vercel deploy response is reconciled through a bounded deployment inventory:
zero exact-source candidates permits one create, one exact candidate is reused,
and multiple candidates stop as ambiguous. Existing mode-0600 FORCE postflight
or final recovery evidence is reused only after every release, role, run, hash,
route and no-mutation field validates; it is never overwritten or assumed valid
because the file exists.

The runtime path updates the sensitive Production `DATABASE_URL`, builds the
exact currently deployed source `69c14c0618ea7ab9c74756422273d17d66db7efa`
with `--prod --skip-domain`, requires READY state, then promotes and verifies
all canonical aliases and `/api/health`. The owner path updates only the
protected GitHub Production migration secret and SHA-256 variable plus the
dedicated ignored local owner file. No migration command exists in this
operator; CheckoutStockReservation remains outside its executable surface.

Execution is not permitted while the local GitHub CLI authentication is
invalid. That prerequisite must be restored before any Neon password reset so
the owner rotation cannot strand the protected migration consumer.

Any ambiguous restart state must stop and inspect. Do not repeat a non-idempotent
Neon password reset merely because the first response was lost; reveal the
current stored password and compare only in memory against the private recovery
state before choosing the next step.

## Diagnostic rules added by this incident

- Never print `.env*` assignment lines for secret-bearing keys. Parse in memory
  and emit only bounded identity fields such as role, pooler/direct shape,
  port, and TLS parameter names.
- Never emit raw `vercel env ls --format json`; normalize metadata before
  output because encrypted variables can include ciphertext fields.
- A read-only database proof must still stop when its credential was exposed;
  read-only transaction semantics do not make a compromised password safe.
- Credential recovery is a production/provider mutation and remains a separate
  explicit boundary even when the exposure was caused locally.
