# Order compatibility production release — 2026-09-01

Status: isolated guarded-release packaging; not merged, dispatched, migrated or
deployed.

## Why this is one Order stack and one separate Case correction

The compatible Order program now has 17 ordered, additive migrations from
`20260831233000_prepare_order_participant_list_authority` through
`20260901150000_prepare_order_charged_total`. CI already replays them in order
and proves each fixed-operation family. Splitting those 17 migrations into 17
manual production releases would add operational failure surfaces without
creating a stronger authority boundary. Applying them as an exact byte-pinned
prefix is proportional because they all preserve `Order` RLS-off posture and
predecessor runtime CRUD for old/new deployment coexistence.

`20260901160000_correct_case_order_invariants` remains separate. It replaces
authority on the already-live policyless FORCE Case family and therefore must
not be swept into the Order operation merely because it is lexically adjacent.

## Guarded Order workflow

`.github/workflows/order-compatible-production.yml`:

- runs only as a manual `main` workflow in the protected Production environment;
- binds the exact 40-character `main` commit to a successful push CI run;
- verifies the reviewed direct-owner credential through the shared production
  migration guard;
- refuses any migration successor after the exact Case correction;
- byte-verifies all 17 Order migrations and the isolated Case successor;
- removes the Case successor from the runner tree before `migrate deploy`;
- accepts only an exact zero-through-17 applied migration prefix with matching
  checksums, one finished step, no rollback and no gaps;
- proves `Order` remains RLS off, FORCE off, policyless, and retains predecessor
  runtime CRUD while PUBLIC CRUD stays absent;
- proves `chargedTotalCents` is absent before its exact final prefix and is one
  nullable, default-free integer column afterward;
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
- requires all 17 Order compatibility rows to be fully and exactly applied;
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
3. Run the distinct pooled-runtime read-only Order postflight. This is a hard
   evidence boundary, not a repeat of the owner-side catalog check.
4. Run the separate Case correction workflow from exact green `main`.
5. Deploy the exact compatible application and verify aliases/health/source.
6. Exercise authenticated buyer quote, seller label/re-quote, fulfillment,
   refund, Case replay and presentation smokes without live-mode purchases.
7. Drain all superseded compatible deployments.
8. Re-prove zero ordinary-runtime direct `Order` access.
9. Prepare and activate policyless Order Phase A, then a separate FORCE release.
10. Continue with `OrderItem`, then `OrderShippingRateQuote`, as separate RLS
    groups.

This release does not enable or FORCE Order RLS, revoke predecessor Order CRUD,
mutate Order row data, run a provider operation, deploy application code, or
change credentials/provider configuration.

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
  posture and installed-source hashes derived from the 17 byte-pinned
  migrations;
- a fresh absent actor sees zero buyer/seller list results and cannot project a
  sampled Order through the buyer v3 or seller v4 detail functions; and
- the dormant staff projection is directly denied with PostgreSQL `42501`.

The proof emits only booleans, counts of reviewed catalog objects and release
bindings to a fresh mode-0600 evidence file. It does not export production row
identifiers or mutate production. CI reruns the same proof against the real
ordinary runtime login after applying the exact compatible stack in disposable
PostgreSQL.
