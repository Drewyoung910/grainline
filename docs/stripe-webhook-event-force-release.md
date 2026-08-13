# StripeWebhookEvent FORCE RLS release

Status: FORCE is live in production and accepted. Exact main
`ea19fa0ace85dd61868667022c45afb3cf3218fa` passed CI `31716577153`;
guarded Production Migrations run `31717354633` applied only
`20260810172000_force_stripe_webhook_event_rls`. Migration status and the
global grant/RLS audit passed. Both database passwords were replaced by the
accepted recovery sealed at `7bf07801152962eca4d3e5e3a0cfe9cb5b88ba89`,
and the read-only pooled-runtime FORCE postflight passed with the replacement
runtime credential at `2026-08-13T18:32:53Z`. See
`docs/database-credential-exposure-recovery-20260813.md` for the
database-credential exposure and accepted recovery record.

## Exact release unit

- Preparation PR #188 merged exact head
  `b8a9f41b9f5ca966f02901fb322ba9775210fd80` as main
  `6d448bce38bed2aa54bf4ce7ae8e5f8a4ba73186`; PR CI `31417322388` and
  preparation exact-main CI `31419148169` passed.
- Migration: `20260810172000_force_stripe_webhook_event_rls`
- Reviewed FORCE draft SHA-256:
  `eeb9f8cc287b0b9c7302684bfab02d74eaa82d5851018d08c4129ab65f92a90f`
- Promoted migration SHA-256:
  `5ec7855aca90679dcaad3d85490dde9a469b6b1b3a7c9d7a5b9aeb3b65e672e7`
- Reviewed rollback SHA-256:
  `16766a26bcab922f522c29c5e98eebfb09eead213ad9228c9b0b75d05228fd6a`
- Complete migration-tree SHA-256:
  `45c31a6b00bed329281022490b663088e94403abab95f31cd7e22d3cc4e4a14c`
- Guard phase: `stripe-webhook-event-force-reviewed`

The transaction changes only `relforcerowsecurity` on
`public."StripeWebhookEvent"`. It changes no row, policy, grant, function,
constraint, index, application code, deployment, provider variable or Stripe
resource. The rollback changes only FORCE back to NO FORCE while preserving
policyless ENABLE and the fixed-function authority boundary.

## Accepted predecessor

Policyless Phase A is live from exact main
`f987645784a447604fcab2399dc8e7fd7bef9d7c`. Exact-main CI `31408797498`
passed; guarded Production Migrations run `31410550315` applied only
`20260805060000_enable_stripe_webhook_event_rls`; migration status and the
global grant/RLS audit passed. The separate actual pooled-runtime postflight
then proved exact runtime identity, policyless ENABLE/NO FORCE, direct table
denial, all six function sources/modes/owners/ACLs, aggregate health and the
read-only write-function fence with `productionChangedByPostflight=false`.

## Preflight and failure boundaries

The FORCE migration takes the same advisory lock as Phase A plus an
`ACCESS EXCLUSIVE` table lock and fails closed unless all of these remain true:

- `grainline_app_runtime` is LOGIN, NOINHERIT, NOSUPERUSER and NOBYPASSRLS,
  with no create/replication privileges;
- the only accepted direct or transitive membership edge is Neon's
  non-effective `cloud_admin`-granted `neondb_owner` admin membership in the
  runtime role with both INHERIT and SET disabled;
- the current session is the exact table owner: production `neondb_owner` is
  NOSUPERUSER/BYPASSRLS, while disposable `ci` is superuser in
  `grainline_ci`;
- no other owner client session remains in the database;
- the table is the exact owner-held policyless ENABLE/NO-FORCE Phase-A state
  with zero runtime/PUBLIC table or column authority;
- the six runtime-executable functions retain their exact identities, source
  hashes, owner, SECURITY DEFINER/mode/search-path settings and non-grantable
  runtime-only ACLs; and
- no additional trusted-name overload or runtime-executable function touching
  `StripeWebhookEvent` exists.

The migration does not make the BYPASSRLS owner subject to RLS. FORCE is kept
as a durable ownership-drift invariant: a future non-BYPASS table owner cannot
silently bypass the policyless service boundary merely by owning the table.

## Proof ordering

CI must first byte-verify the complete FORCE release and the sealed Phase-A
prefix while both migrations are still present, then remove both migrations
before its compatible deploy. It restores and
proves Phase A alone, including the actual runtime-login postflight and
database-first Phase-A rollback. Only then may it restore and apply FORCE,
verify migration status, rerun the global grant/RLS audit, exercise all six
fixed operations behind FORCE in a rollback-only transaction, and prove the
NO-FORCE emergency rollback plus exact FORCE restoration.

The guarded Production Migrations workflow accepts only
`stripe-webhook-event-force-reviewed`, verifies the exact release before
`prisma migrate deploy`, then verifies migration status and the global
grant/RLS audit. It does not deploy application code or change Stripe/Vercel
provider state.

## Failed candidate evidence

Draft-head CI run `31415661672` at `01f6e53cac51e48e5a4b8d15d5fe470807989d98`
failed before any Prisma deploy or PostgreSQL proof because the workflow moved
the Phase-A migration directory aside before invoking its sealed-prefix
verifier. The failure changed no persistent or production state; the CI
PostgreSQL service was disposable and no migration command had run. The
corrected workflow verifies Phase A while both exact migrations remain present,
requires the exact reviewed FORCE successor guard, and only then isolates the
two releases for ordered engine proof.

## Production execution evidence

Production run `31717354633` verified the complete CheckoutStockReservation
successor tree, isolated `20260810190000_prepare_checkout_stock_reservation_authority`
from the Actions checkout, reverified the exact FORCE-only tree, and then
applied the FORCE migration. Prisma reported exactly that migration applied and
the isolated 193-migration tree up to date. The final audit reported 64 tables,
22 enums, 138 `grainline_*` functions, one extension, four policy-bearing RLS
tables, and zero sequence references. The engine-attested ledger proof recorded
`forceApplied=true`, `successorRows=0`, and
`productionChangedByProof=false`.

No application deployment, CheckoutStockReservation migration, or provider
change accompanied the migration run. The later credential recovery deployed
the same application source solely to install the replacement runtime
credential, then executed
`npm run ops:stripe-webhook-event-force-postflight` from the exact clean FORCE
release commit with the actual pooled production `grainline_app_runtime` URL.
The engine-attested repeatable-read/read-only proof rejected owner or aliased
URLs, proved FORCE plus the same six-function/direct-denial boundary, and
recorded `status=passed` and `productionChangedByPostflight=false` in sanitized
mode-0600 evidence. This closes the database-release acceptance gate.

Connect v2 signed delivery and live-mode provider topology remain mandatory
launch gates. They are not part of this posture-only database release and must
not be used to broaden or reorder it.

## Successor-isolated production runner correction

Current `main` now also contains the separately reviewed but unapplied
`20260810190000_prepare_checkout_stock_reservation_authority` successor. A
plain `prisma migrate deploy` from that tree would collapse the FORCE and
reservation-authority boundaries. The production workflow therefore verifies
the complete successor tree and both byte-pinned releases first, moves only the
reservation successor out of the disposable Actions checkout, re-verifies the
exact FORCE-only tree, and only then invokes Prisma. After migration status and
the global grant/RLS audit pass against that isolated tree, an engine-attested
read-only transaction requires exactly one successful FORCE row and zero rows
for the reservation successor, then rolls back. The proof emits only migration
names and booleans; it does not mutate production or expose credentials,
timestamps, checksums, or row data.

The runner correction performed exactly that isolation in successful run
`31717354633`. It did not apply reservation authority, deploy application code,
merge PR #196, or change provider state. The later reservation-authority
release still requires its own wiring, refreshed inspection, exact-main CI,
dispatch and postflight before application code that calls those fixed
functions may be deployed.
