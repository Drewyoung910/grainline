# Core Order FORCE accepted

Recorded: 2026-09-30

This is a sanitized Production checkpoint. It contains no credential, raw
database URL, row data, session value, or synthetic fixture value.

## Exact admission

- release/main: `52b78554b795a5e4b2035c8dd05695cbda790a47`
- successful merged-main CI: `36657639939`
- accepted item/quote runtime-lock predecessor: `36647432346`
- reviewed live deployment: `dpl_FpD59NTBtkRj4v1KP5yEjMRdvNdj`
- protected Core FORCE run: `36659832849`
- workflow: `Core Order FORCE production (protected)`
- migration: `20260929160000_force_order_rls`
- migration SHA-256:
  `1f48553466fd1ee0373d48036e5e193cedbb6d4ff094ad1fba753e8c75e7e139`
- protected run completed successfully at `2026-09-30T02:27:39Z`

The protected run bound itself to exact public main, the exact successful
merged-main CI, the accepted runtime-lock run and its ancestor relationship,
and the exact live zero-direct deployment. Its live deployment proof, release
byte proof, owner-connection guard, predecessor ledger/catalog read, pre-FORCE
global grant audit, no-other-pending-migration check, isolated migration
application, owner-visible ledger/catalog proof, post-FORCE global grant audit,
and final Prisma migration status all passed.

The run applied only `20260929160000_force_order_rls`. It changed Core
`public."Order"` from RLS enabled/no FORCE to RLS enabled/FORCE. It created no
policy and changed no child-table RLS posture, application route, credential,
deployment, alias, provider, or other migration.

## Independent ordinary-runtime postflight

The separately authenticated pooled `grainline_app_runtime` postflight ran
from exact clean release commit `52b78554` inside a repeatable-read, read-only
transaction. It passed at `2026-09-30T02:29:42.100Z` and proved:

- Core `Order` RLS enabled and FORCE enabled;
- zero Core `Order` policies;
- no direct ordinary-runtime `Order` table or column authority;
- direct Core `Order` SELECT denied by PostgreSQL with SQLSTATE `42501`;
- no row data read or exported;
- the six reviewed staff SECURITY DEFINER functions retained for the isolated
  staff runtime and absent from ordinary runtime authority;
- `OrderItem` and `OrderShippingRateQuote` unchanged from their accepted
  runtime lock;
- authenticated role `grainline_app_runtime`, without owner membership;
- a repeatable-read, read-only transaction; and
- no Production change made by the postflight.

Sanitized local evidence:

`order-core-rls-force-postflight-20260930/order-core-rls-force-postflight-52b78554b795a5e4b2035c8dd05695cbda790a47.json`

The evidence is a mode-0600 regular file. Its SHA-256 is
`4acab410030ff50a614c25b2b909ee0c106e9755325b087ea5b605f965405403`.

## Failed-closed predecessor attempt

Protected run `36654718099` failed before any database read or SQL because a
non-US GitHub runner correctly received the application's US-only
`307 /not-available` response, while the release verifier incorrectly required
an unconditional homepage HTTP 200. Release-tooling-only PR #480 fixed that
boundary at exact head `db61e26e56f2a2f93d6c9ca1ed7682c4f1f4573c`, adding strict
same-origin HTTPS/path validation and requiring the exact deployment marker on
the geo-allowed destination. All four exact-head checks and merged-main CI
passed. The application and FORCE migration bytes were unchanged.

## Accepted state and next work

Core `Order` FORCE RLS is live and accepted. Do not repeat Core ENABLE, the
item/quote runtime lock, FORCE, their accepted CI suites, or either accepted
runtime postflight. Continue the separately tracked application-finding and
remaining RLS-table queues from their current checkpoints; Core Order FORCE is
no longer a blocker.
