# Database credential exposure recovery — 2026-08-13

Status: recovered and accepted. No credential value belongs in this document,
a commit, a PR, an Actions artifact, or ordinary terminal output.

The restart-safe recovery completed at `2026-08-13T18:32:53.179Z` from exact
operator commit `7bf07801152962eca4d3e5e3a0cfe9cb5b88ba89`, after exact-head
CI `31730856176` passed. Sanitized mode-`0600` evidence is retained outside the
repository as `database-credential-recovery-20260813.json`, SHA-256
`ed7f8952c1eb5d72aa9d661701c64cc0153eed48f59494e3fe136b2c80e8e943`.
It records `status=passed`, `acceptanceEligible=true`, zero issues, zero
migrations and no provider change outside the authorized recovery.

## Incident and scope

A local diagnostic printed the complete production `neondb_owner` and pooled
`grainline_app_runtime` PostgreSQL URLs into agent tool output. Neither value
entered tracked files, commits, PRs, Actions artifacts or accepted RLS
evidence, but both passwords were treated as compromised.

The recovery preflight also found two non-Production paths resolving the owner
URL: a Grainline Development `DATABASE_URL` and a shared encrypted
`DATABASE_URL` linked to Grainline. The project Production value overrode the
shared record for Production builds, but Development and Preview could resolve
owner authority. The accepted recovery removed only Grainline's exact
Development record and unlinked only Grainline from the shared record; the
shared team variable itself was retained.

## Accepted outcome

The operator:

- rotated only `grainline_app_runtime` and `neondb_owner` through Neon;
- proved both superseded passwords reject with PostgreSQL SQLSTATE `28P01` and
  both replacement identities authenticate with their reviewed role posture;
- updated only the sensitive Vercel Production `DATABASE_URL`, protected
  GitHub Production migration secret and digest, and dedicated ignored
  mode-`0600` local credential files;
- proved Development and Preview resolve no `DATABASE_URL`;
- removed legacy local owner/runtime assignments rather than perpetuating
  duplicate consumers;
- deployed the exact then-current source
  `69c14c0618ea7ab9c74756422273d17d66db7efa` as replacement deployment
  `dpl_C3N3PudFHg4GoRMAAZJuz9aNZ5Y6`, solely to receive the replacement pooled
  credential; and
- ran the actual pooled-runtime StripeWebhookEvent FORCE postflight with
  `productionChangedByPostflight=false`.

No migration, grant, RLS, Stripe, CheckoutStockReservation, Case-evidence or
cleanup-schedule change occurred. The private restart journal was deleted only
after every acceptance assertion passed.

## Durable operational rules

- Parse secret-bearing environment files in memory and emit only bounded
  identity facts; never print assignment lines.
- Do not emit raw Vercel environment JSON. Normalize provider metadata before
  output because encrypted records may contain ciphertext fields.
- A read-only database proof still stops if its credential was exposed.
- Vercel environment changes affect only new deployments; replacement runtime
  credentials require a new READY deployment and explicit alias verification.
- Never replay a Neon password reset after a lost response. Reveal the
  provider-held value and compare only in memory against private restart state.
- Prior-password rejection is part of deployment-drain reasoning: deployments
  older than replacement `dpl_C3N3PudFHg4GoRMAAZJuz9aNZ5Y6` cannot use their
  embedded superseded runtime password to reach production PostgreSQL.

The original operator release is immutable. This restored completion record
fixes a previously dangling architecture/coverage reference and does not alter
the executed recovery.
