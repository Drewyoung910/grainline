# OrderPaymentEvent policyless activation release

Status: isolated reviewed candidate only. Production remains on the accepted
transition-authority application with `OrderPaymentEvent` RLS off, zero
policies and predecessor runtime CRUD retained. Nothing in this record
authorizes merge, workflow dispatch, migration execution, deployment, FORCE
RLS, provider changes, or activation of `Order`, `OrderItem` or
`OrderShippingRateQuote`.

Prepared: 2026-08-30.

## Exact candidate

- activation migration:
  `20260830030000_enable_order_payment_event_rls`
- guarded phase: `order-payment-event-activation-reviewed`
- activation draft SHA-256:
  `4d7705f8a4d8f0156a05e4f87e6c62ccc42c9e48936dc0beeaf0f333242376c6`
- promoted migration SHA-256:
  `0566632d372524667ad80e5cf6ed76250ca13abc838b8fdce60e3cb909fb83c1`
- migration-tree SHA-256 through activation:
  `389cfab874e29921027e6661f7abd8e8286a46db8505cac589d15823c57b3adf`
- emergency rollback SHA-256:
  `4f85a61d18e0b53faec5b9abdbd3d52f53cf176392b61a0ca908be1abd957568`

The promoted migration is generated mechanically from the reviewed draft by
replacing only the draft header. The release verifier compares the promoted
bytes with that generated candidate and seals the complete migration prefix.
The candidate creates no function or policy, changes no row and does not
enable FORCE.

## Domain and authority decision

`OrderPaymentEvent` is private service evidence, not a participant-authored or
participant-readable table. Phase A therefore follows the policyless service
ledger design already accepted for `StripeWebhookEvent`,
`CheckoutStockReservation`, `SellerPayoutEvent` and
`OrderRefundReconciliation`:

- enable RLS while explicitly retaining `NO FORCE`;
- install exactly zero policies;
- revoke all table and column authority from `PUBLIC` and
  `grainline_app_runtime`;
- retain only source-validating fixed functions whose complete catalog,
  source, owner, configuration and ACL are proven; and
- keep posture-only FORCE as a later independent release with a fresh actual
  pooled-runtime postflight.

The accepted repository-wide zero-direct-access proof scanned all 738 tracked
JavaScript/TypeScript files and found exactly seven fixed-authority consumers,
12 reference files, five fixed database operations and zero direct base-table
access. Retain its sanitized evidence SHA-256
`6298a1dc376bec73f2abcb896d54913815e155717cd004596b622b6439208590`.
The separate credential-epoch drain removed all 11 reviewed superseded READY
deployments and retained only current deployment
`dpl_Coyjd6rTXteBV9e4QZtZGFDaiEYc`; retain evidence SHA-256
`1596ad71479f7a9bda51b00c94b3ac27bea6adf6a5454eb34e03c35618764e5d`.

## Final fixed-function inventory

The activation catalog is composed from the latest byte-sealed compatible,
signed-refund, signed-dispute, transfer-binding, invariant, read-authority,
aggregate-authority and transition-authority releases. It contains exactly 29
functions:

- 16 retained ordinary-runtime fixed operations;
- two predecessor entry points whose runtime `EXECUTE` is retired by
  activation; and
- 11 functions that were already runtime-private, yielding 13 private
  functions after activation.

The two retired identities are:

- `grainline_blocked_checkout_refund_claim(text,bigint,text,text,integer)`;
- `grainline_case_seller_refund_apply(text,text)`.

Tracked application source calls exactly the 16 retained operations. The two
retired functions remain installed only so the byte-pinned database-first
rollback can restore predecessor compatibility; current application source no
longer calls them. The catalog requires the exact identity, owner, language,
volatility, parallel mode, `SECURITY DEFINER` posture where applicable, pinned
`search_path=pg_catalog`, source MD5, runtime ACL, no `PUBLIC` execution, no
unexpected overload and no dynamic SQL.

The review caught a stale hand-composed catalog before release: it omitted the
latest `grainline_blocked_checkout_transfer_bind` successor and retained older
signed refund/dispute definitions. The final catalog is now mechanically
composed from the latest sealed sources. This correction changed no production
state.

## Activation transaction

The migration obtains one advisory lock and follows the writers' existing
parent-first relation order: `Order`, then `OrderPaymentEvent`, both with
bounded lock and statement timeouts. Before changing posture it fails closed
unless all of the following are exact:

1. table ownership by the current migration login, accepted only as production
   `neondb_owner` or disposable `ci` in database `grainline_ci`, plus the
   restricted runtime-role posture;
2. RLS off, FORCE off, zero policies and exact predecessor table/column ACLs;
3. all six validated constraints, seven indexes and seven exact enabled,
   non-internal trigger bindings across `OrderPaymentEvent` and `Order`;
4. zero rows violating the accepted taxonomy, source, amount, currency, text,
   metadata and timestamp invariants;
5. the exact 29-function catalog and trusted-name overload surface;
6. exactly 25 signature-bound reviewed functions directly reference
   `OrderPaymentEvent`: 18 members of this release's 29-function catalog plus
   seven already-sealed Case/Notification cross-system functions; and
7. the accepted transition-authority predecessor migration and migration
   ledger state.

Only after those checks does it enable RLS, explicitly retain `NO FORCE`,
revoke all ordinary-runtime/PUBLIC table authority and revoke runtime execution
of the two retired entry points. It performs zero row DML.

## Restart-safe production scope

The production scope verifier runs through the protected owner credential in
an engine-enforced read-only transaction. It accepts only:

1. `transition-authority-prepared`: the exact accepted predecessor is applied,
   the activation row is absent, RLS is off, predecessor CRUD and 18 runtime
   functions are exact; or
2. `activated`: one exact completed activation row exists, policyless ENABLE
   plus `NO FORCE` is present, table CRUD is absent and the final 16-runtime / 13-private
   function partition is exact.

Unknown, duplicate, unfinished, rolled-back, checksum-drifting or partial
states fail closed. The global runtime grant audit and runtime-role provisioning
contract understand both exact states without weakening any previously
activated table.

## Disposable PostgreSQL and rollback proof

CI uses separate loopback logins for the owner (`ci`) and ordinary runtime
(`grainline_app_runtime`). The activation proof requires:

- an engine-attested repeatable-read/read-only catalog transaction;
- exact restricted runtime identity;
- all four direct table operations denied with SQLSTATE `42501`;
- both retired function calls denied with SQLSTATE `42501`;
- all four participant read projections executable with empty foreign input;
- the staff timeline function body reached and its staff authorization denied;
- no production connection and no row mutation.

The byte-pinned emergency rollback is database-first. Before rollback it
requires the exact activated table ACL and all 29 function source/ACL records;
it explicitly rejects unexpected `PUBLIC` table or function grants. It restores
only predecessor CRUD and the two retired runtime entry points, proves that
predecessor boundary through the distinct runtime login, then reapplies and
re-attests the exact activation. It changes no fixture rows. A failed
restoration is surfaced as an aggregate failure.

The hard review strengthened the rollback from posture-only checks to exact
before-and-after ACL and function-catalog checks. It also strengthened trigger
verification from name-only matching to exact relation, trigger name,
function, trigger type and enabled/non-internal state. Both corrections landed
before any persistent database application.

Hosted CI `33339776682` then failed closed at the activation step because the
initial role check required production owner name `neondb_owner` even in the
disposable database, whose exact owner is `ci`. The correction does not accept
an arbitrary owner: the table must be owned by `CURRENT_USER`, and the login
must be either `neondb_owner` or exactly `ci` in database `grainline_ci`.
Protected production workflow identity checks remain unchanged.

Replacement hosted CI `33340360157` reached the activation and then rejected
two exact functions because the preflight used the presence of `FORMAT(` as a
proxy for dynamic SQL. Both sealed bodies use `pg_catalog.format()` only for
human-readable reconciliation text and contain no PL/pgSQL `EXECUTE`. The
corrected catalog retains the actual no-`EXECUTE` check and exact source MD5s
for all 29 functions while permitting those two non-dynamic formatting calls.
Production again remained untouched.

## Remaining release boundaries

1. Pass hosted CI including real PostgreSQL activation and rollback proofs.
2. Review and merge the exact isolated activation head.
3. Separately authorize and run the guarded Phase-A Production Migrations
   release, then retain its exact migration/global-audit/scope evidence.
4. Run a distinct actual pooled `grainline_app_runtime` read-only production
   postflight. Do not infer it from owner-catalog proof.
5. Prepare and release posture-only FORCE separately, then repeat the actual
   pooled-runtime proof.

`Order`, `OrderItem` and `OrderShippingRateQuote` remain later separately
audited and activated tables. This release is not authority to bundle them.
