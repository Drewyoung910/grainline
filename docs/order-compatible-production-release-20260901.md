# Order compatibility production release — 2026-09-01

Status: the complete 18-row compatibility prefix is applied and accepted in
production. Order RLS remains off with predecessor runtime CRUD retained. The
separate Case correction was subsequently applied and accepted without changing
the Case family table posture. The compatible application is live from exact
main `bbf7afc1c105dc2a3ea9dadaeeb779ee971a5197`, bound to successful
exact-main CI `33590139765`, as READY production deployment
`dpl_3GTnqQGHGjGPSkCnEMq65yFAU91u`.

## Why this is one Order stack and one separate Case correction

The compatible Order program now has 18 ordered, additive migrations from
`20260831233000_prepare_order_participant_list_authority` through
`20260901155000_correct_order_participant_list_projection`. CI replays them in
order and proves each fixed-operation family. Splitting those 18 migrations
into 18 manual production releases would add operational failure surfaces
without creating a stronger authority boundary. Applying them as an exact
byte-pinned prefix is proportional because they all preserve `Order` RLS-off
posture and predecessor runtime CRUD for old/new deployment coexistence.

`20260901160000_correct_case_order_invariants` was kept separate. It replaces
authority on the already-live policyless FORCE Case family and therefore was
not swept into the Order operation merely because it is lexically adjacent.

## Guarded Order workflow

`.github/workflows/order-compatible-production.yml`:

- runs only as a manual `main` workflow in the protected Production environment;
- binds the exact 40-character `main` commit to a successful push CI run;
- verifies the reviewed direct-owner credential through the shared production
  migration guard;
- refuses any migration successor after the exact Case correction;
- byte-verifies all 18 Order migrations and the isolated Case successor;
- removes the Case successor from the runner tree before `migrate deploy`;
- accepts only an exact zero-through-18 applied migration prefix with matching
  checksums, one finished step, no rollback and no gaps;
- proves `Order` remains RLS off, FORCE off, policyless, and retains predecessor
  runtime CRUD while PUBLIC CRUD stays absent;
- proves `chargedTotalCents` is absent before prefix 17 and is one nullable,
  default-free integer column at prefixes 17 and 18;
- converges the reviewed runtime function grants, checks migration status while
  the Case successor is isolated, runs the global grant/RLS audit, and repeats
  the read-only final scope proof; and
- restores the still-unapplied Case migration only in the ephemeral runner tree.

A failed deployment can leave only an exact applied prefix. A restart accepts
that prefix and lets Prisma continue. Unknown rows, duplicate rows, checksum
drift, gaps, rolled-back rows, incomplete rows, premature Case application,
Order RLS/grant drift, or charged-column drift fail closed before mutation.

## Guarded Case workflow

`.github/workflows/case-correctness-production.yml`:

- has the same exact-main, successful-CI, protected-owner and concurrency gates;
- refuses any successor after the Case correction;
- requires all 18 Order compatibility rows to be fully and exactly applied;
- accepts only an absent or exact applied Case-correction row on restart;
- proves `Case`, `CaseMessage` and `CaseMessageAttachment` remain owned by the
  migration role with ENABLE plus FORCE, zero policies, and zero direct
  runtime/PUBLIC CRUD;
- applies only the Case correction when absent; and
- verifies migration status, the global grant/RLS audit and the exact read-only
  final scope afterward.

## Shipping quote evidence and its limits

The buyer quote implementation has both source-level regression coverage and a
real non-charging Shippo test-mode smoke. The provider accepted the shared
minimized city/state/postal/country payload and returned 11 usable USD rates
from two carriers. The sanitized evidence SHA-256 is
`96e55d3d601ab8df7442d42fa2fc8dec4218300c239ba10540a7bdada39c1959`.

That evidence proves current test-account authentication, request shape,
response parsing, provider-ID validation and bounded rate normalization. It
does **not** prove:

- arbitrary real-world deliverability or live-mode carrier availability;
- a production purchase or label transaction;
- final full-address seller label re-quote and purchase;
- every provider no-rate/error response; or
- production credential topology.

Those are separate authenticated smoke and launch/provider checks. They do not
justify delaying this compatible database release, but the label purchase and
retry paths must be exercised before predecessor drain and Order Phase A.

## Remaining sequence

1. ~~Merge this workflow-only package after full CI.~~ Completed in merge
   `004ebddf49c28489644234cff9180743584ea994`; exact push CI
   `33579332247` passed.
2. ~~Run the Order compatible workflow from exact green `main`.~~ Production
   run `33580353283` applied the exact 17-row prefix, converged runtime grants,
   passed migration status, the global grant/RLS audit and the final owner-side
   read-only scope proof. `Order` remains RLS off with predecessor CRUD.
3. ~~Run the distinct pooled-runtime read-only Order postflight.~~ The first
   attempt exposed a participant-list projection mismatch. PR #387 merged the
   exact correction as main `fb27a5efe9551ceec724b92e2d3c39cd9c50bd87`;
   exact-main CI `33585371689` passed. Guarded run `33586737852` advanced only
   the reviewed Order prefix from 17 to 18 rows, reconverged existing runtime
   grants, and passed migration status, the global grant/RLS audit and final
   owner-side scope. The distinct actual pooled-runtime proof then passed all
   six checks without mutation. Retain sanitized mode-`0600` evidence SHA-256
   `1125e28f4a94140ef82c39e74f6b28279d8eb8c16fb4e24337b5c4a98d8e1d89`.
4. ~~Run the separate Case correction workflow from exact green `main` only
   after the 18-row Order prefix and pooled-runtime proof are complete.~~ Exact
   main `e0c17bc31d8da57b2418004ec451cdeb2b776854` and CI `33588063084`
   passed. Guarded run `33588992199` classified the exact `order-compatible`
   restart state, applied only
   `20260901160000_correct_case_order_invariants`, and finished
   `case-corrected`. Migration status and the global grant/RLS audit passed.
   The after-scope retained all 18 Order predecessor rows and proved all three
   Case-family tables ENABLE plus FORCE, zero direct runtime CRUD and the exact
   Case-correction ledger row.
5. ~~Deploy the exact compatible application and verify
   aliases/health/source.~~ Exact main
   `bbf7afc1c105dc2a3ea9dadaeeb779ee971a5197`, bound to successful CI
   `33590139765`, is live as READY deployment
   `dpl_3GTnqQGHGjGPSkCnEMq65yFAU91u`. All four canonical aliases, authenticated
   deployment health and exact source metadata were verified. READY predecessor
   `dpl_Coyjd6rTXteBV9e4QZtZGFDaiEYc` remains retained and undrained.
6. Exercise authenticated buyer quote, seller label/re-quote, fulfillment,
   refund, Case replay and presentation smokes without live-mode purchases.
7. Drain the retained predecessor so obsolete overlap-only function grants can
   be retired.
8. Convert the remaining 16 direct-`Order` source files across checkout,
   refund, staff and maintenance families; complete staff-role and final
   invariant preparation; then deploy and smoke the zero-direct application.
9. Drain every deployment that can still depend on direct `Order` table CRUD
   and prove zero ordinary-runtime direct `Order` access.
10. Prepare and activate policyless Order Phase A, then a separate FORCE
    release.
11. Continue with `OrderItem`, then `OrderShippingRateQuote`, as separate RLS
    groups.

The database release did not enable or FORCE Order RLS, revoke predecessor
Order CRUD, mutate Order row data, run a provider operation or change
credentials/provider configuration. The subsequent application deployment
changed application source only; it did not run migrations or change database,
credential or provider-variable state.

## Compatible application production deployment

The deployment was created from a clean isolated checkout detached at exact
main `bbf7afc1c105dc2a3ea9dadaeeb779ee971a5197` after exact-main CI
`33590139765` passed. It was created as a Production-target deployment without
canonical public aliases, attested READY, checked through authenticated Vercel
health access, and then explicitly promoted. Deployment
`dpl_3GTnqQGHGjGPSkCnEMq65yFAU91u` now serves:

- `thegrainline.com`;
- `www.thegrainline.com`;
- `grainline.vercel.app`; and
- `grainline-drew-youngs-projects.vercel.app`.

Canonical `/api/health` returned `{ "ok": true }`, and Vercel deployment
metadata retained the exact release commit and CI run. The previous READY
deployment `dpl_Coyjd6rTXteBV9e4QZtZGFDaiEYc` remains available as the bounded
rollback predecessor. It was not drained.

Operational note: `vercel deploy --prod --skip-domain` still attached the
project-level `grainline-drew-youngs-projects.vercel.app` alias to the new
deployment. The other three canonical aliases remained on the predecessor
until the explicit promotion. Future staged Production releases must inspect
the actual alias set after deployment; `--skip-domain` is not proof of a
completely alias-free deployment.

## Accepted Case-correction boundary

The Case correction was deliberately executed after, not as part of, the Order
compatibility release. Exact workflow run `33588992199` applied only
`20260901160000_correct_case_order_invariants` from exact main
`e0c17bc31d8da57b2418004ec451cdeb2b776854`, bound to successful push CI
`33588063084`. The restart proof observed 18 exact Order rows and an absent Case
correction. The final read-only proof reported `state=case-corrected`,
`caseCorrectnessApplied=true`, three Case-family tables, ENABLE plus FORCE, and
`directRuntimeCrud=false`. The global audit passed for 65 tables, 22 enums, 240
`grainline_*` functions, one extension, four RLS policy tables and zero sequence
references. No application deployment, Order RLS change, provider operation or
credential change occurred.

## Validation history

Pull-request CI run `33576956310` failed before any production operation when
the first real PostgreSQL scope query passed the `PUBLIC` ACL pseudo-role to
`has_table_privilege` as though it were a login role. PostgreSQL correctly
returned `42704 role "PUBLIC" does not exist`. Both scope readers now inspect
PUBLIC table authority through `aclexplode(...).grantee = 0`, and a class-wide
test rejects the invalid role-name form. No database, deployment or provider
state changed in the failed run.

Pull-request CI run `33581754025` then failed only in the newly added pooled
runtime behavioral postflight with PostgreSQL `structure of query does not
match function result type`. All predecessor authority tests and catalog/source
checks passed. The proof remains fail-closed and now runs its six absent-actor
calls separately so the corrected run identifies the exact projection instead
of reporting one compound-query error. Production was not touched by this CI
failure.

Corrected pull-request CI run `33582323698` localized the PostgreSQL `42804`
failure to `grainline_order_buyer_page`. A real-schema audit found that the
predecessor list migration returned `Order.shippingTitle varchar(200)`, and the
seller list also returned `buyerName varchar(200)` and `buyerEmail varchar(254)`,
through `RETURNS TABLE ... text` columns without explicit casts. The earlier
synthetic test declared these columns as `text`, masking PostgreSQL's exact
return-type requirement. Migration
`20260901155000_correct_order_participant_list_projection` reproducibly replaces
only the two list functions with exact `::text` casts and reconverges their
existing function ACLs. A real-varchar disposable PostgreSQL proof first
reproduces the predecessor failure and then proves both corrected functions and
ACLs. The migration does not alter table data, RLS, policies or table grants.
PR #387 merged the exact correction as main
`fb27a5efe9551ceec724b92e2d3c39cd9c50bd87` after pull-request CI
`33584602487` and exact-main CI `33585371689` passed. Guarded production run
`33586737852` classified the exact 17-row restart state, applied only this
correction, reconverged the existing function grants, and passed migration
status, the global grant/RLS audit and the exact after-scope proof. The Case
successor remained isolated and unapplied; Order RLS remained off.

## Pooled-runtime postflight contract

`scripts/order-compatible-runtime-postflight.mjs` closes the identity gap left
by the owner-run workflow. It connects only through the reviewed pooled
`grainline_app_runtime` URL and executes inside an engine-attested repeatable
read, read-only transaction. It verifies:

- the actual session/runtime role is login-capable, NOSUPERUSER, NOBYPASSRLS,
  NOINHERIT and is not a member of the migration owner;
- `Order` is still the compatible pre-activation predecessor: owner-held,
  RLS/FORCE off, zero policies, runtime CRUD retained, PUBLIC CRUD absent;
- all 40 reviewed runtime functions and all eight runtime-private functions
  exist with exact owner, SECURITY DEFINER, pinned `search_path`, direct ACL
  posture and installed-source hashes derived from the 18 byte-pinned
  migrations;
- a fresh absent actor sees zero buyer/seller list results and cannot project a
  sampled Order through the buyer v3 or seller v4 detail functions; and
- the dormant staff projection is directly denied with PostgreSQL `42501`.

The proof emits only booleans, counts of reviewed catalog objects and release
bindings to a fresh mode-0600 evidence file. It does not export production row
identifiers or mutate production. CI reruns the same proof against the real
ordinary runtime login after applying the exact compatible stack in disposable
PostgreSQL.

The accepted production proof ran from the clean exact-main commit
`fb27a5efe9551ceec724b92e2d3c39cd9c50bd87`, bound to CI `33585371689` and
migration run `33586737852`. It verified the actual pooled
`grainline_app_runtime` identity, compatible Order predecessor posture, exact
40-runtime/8-private function source and ACL catalog, absent-actor list/detail
isolation and direct denial of the dormant staff projection inside an
engine-attested repeatable-read/read-only transaction. It recorded
`productionChangedByPostflight=false`. Retain sanitized evidence SHA-256
`1125e28f4a94140ef82c39e74f6b28279d8eb8c16fb4e24337b5c4a98d8e1d89`.
