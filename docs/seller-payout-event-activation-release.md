# SellerPayoutEvent policyless activation release

Status: isolated, unapplied activation candidate. The predecessor deployment
drain is accepted, the migration and rollback are byte-pinned, and CI proof is
wired on the isolated branch. Nothing in this document authorizes a merge,
production migration, deployment, provider change or later FORCE release.

Prepared: 2026-08-22

## Exact candidate

- prerequisite authority migration:
  `20260815210000_prepare_seller_payout_event_authority`
- activation migration:
  `20260822180000_enable_seller_payout_event_rls`
- activation draft SHA-256:
  `04bed329e4ab1dc4b0f575f672ef6d52e301aba6e4946e1fbfe355134efd5c51`
- promoted migration SHA-256:
  `0347a8d930631b4fbed793eec4d119d1c56adcaa2802a89c61940ef6b62fb4bc`
- rollback draft SHA-256:
  `b311f9ae78a8d093d2b200f68acf17d1b4d6b2dd4d1eda342f701b0b4553a94a`
- migration-tree SHA-256 through activation:
  `f680540b155b116e8fcba1cb3a33e84b87b59f07b53466956554a5313485b006`
- guarded phase: `seller-payout-event-activation-reviewed`

The promoted migration is generated mechanically from the pinned draft by
replacing only its draft header. The staging script refuses non-loopback or
non-`grainline_ci` targets and requires an explicit disposable-database
acknowledgement. The release verifier compares the promoted file byte for byte
with that generated candidate and seals the complete migration prefix.

## Domain and authority decision

The domain audit remains the governing design record:
`docs/seller-payout-event-pre-rls-audit.md`. `SellerPayoutEvent` is a retained
mutable provider projection, not a user-authored row set. It therefore uses the
same policyless service-ledger pattern already accepted for
`StripeWebhookEvent` and `CheckoutStockReservation`:

- RLS is enabled with exactly zero policies;
- the ordinary runtime role receives no table or column authority;
- `PUBLIC` receives no table, column or function authority; and
- the runtime can use only three exact `SECURITY DEFINER` functions whose
  source, owner, signature, language, volatility, parallel mode, pinned search
  path and ACL are checked.

The resulting posture has zero direct runtime/PUBLIC table or column authority.

Those functions are the source-bound payout apply operation, the seller-owned
latest-failure projection and the bounded seller export page. The writer takes
no seller ID, row ID, status or notification recipient. It validates an active
`payout.failed` webhook lease and source object, derives the seller from the
unique connected-account mapping, orders updates by provider event time and is
exact-replay idempotent. The read functions derive ownership from
`SellerProfile.userId`; there is no generic or staff-wide payout table reader.

This boundary protects against accidental or compromised ordinary runtime code
issuing arbitrary table queries. It does not authenticate Stripe signatures or
Clerk sessions inside PostgreSQL, and it does not claim resistance to an
attacker who obtains the separate migration-owner credential.

## Activation transaction

The migration runs in one transaction with bounded lock and statement
timeouts, an advisory release lock and an `ACCESS EXCLUSIVE` table lock. Before
changing posture it fails closed unless all of the following are exact:

1. the session owns the table and that owner is `SUPERUSER` or `BYPASSRLS`, so
   the later FORCE release remains operationally viable;
2. `grainline_app_runtime` is the reviewed `LOGIN NOINHERIT NOBYPASSRLS` role
   with no create-database, create-role, replication or superuser power;
3. the role graph contains no effective or unreviewed membership path, while
   permitting only the known non-effective Neon owner bootstrap edge;
4. RLS and FORCE are off, there are zero policies, and runtime has exactly
   compatible `SELECT`, `INSERT`, `UPDATE`, `DELETE` table authority with no
   extra table, column or `PUBLIC` authority;
5. the provider-time column, five validated constraints and six exact valid,
   ready indexes match the reviewed preparation;
6. every retained row satisfies the failed-payout, amount, currency, source
   identity and provider-time invariants, including zero null provider times;
7. exactly the three reviewed runtime-executable functions exist and exactly
   those three functions directly read or write `SellerPayoutEvent`; and
8. each function body has the source digest derived from the already-pinned
   compatible authority migration.

Only after those checks does the transaction set
`stripeEventCreatedSeconds NOT NULL`, enable RLS, explicitly retain `NO FORCE`,
and revoke all table authority from `PUBLIC` and `grainline_app_runtime`. It
does not create policies or functions and performs no row DML.

The Prisma schema marks `stripeEventCreatedSeconds` required only in this
activation candidate. Old application compatibility is no longer required
because the converted deployment is current on all aliases and the only
current-credential predecessor was removed.

## Proof and rollback contract

The CI sequence first verifies and isolates the activation so every historical
predecessor is still executable against its original migration prefix. It then
applies and proves the compatible authority release, confirms zero direct
application access, restores the exact activation, applies it to PostgreSQL 16,
converges runtime grants, audits the global catalog and uses separate owner and
actual runtime logins for the activation and rollback proofs.

The activation proof requires a direct `grainline_app_runtime` login. It proves
the session and current identities, exact restricted role posture, ENABLE with
NO FORCE and zero policies, zero direct table and column authority, all four
direct operations denied with SQLSTATE `42501`, source-bound fixed writes,
exact replay, seller-isolated reads, forged-source rejection and the SQL
read-only write fence. Fixture residue must be zero.

The database-first rollback is also byte-pinned. It rejects table or column ACL
drift, disables RLS, restores the provider-time column to nullable and restores
only the compatible predecessor CRUD grants. The disposable proof exercises
that predecessor through the actual runtime login, removes its fixture and
reapplies the exact activation before exiting. A failed restore is surfaced as
an aggregate failure rather than hidden.

The production-scope verifier is engine-read-only through the already-reviewed
owner reader. It permits only the exact prepared ledger, the exact activated
ledger, or either during a restart-safe check. Unknown, duplicate, unfinished,
rolled-back, zero-step or checksum-drifting activation rows fail closed. It
retains the three known historical ledger exceptions rather than normalizing
or rewriting production history.

## Accepted predecessor evidence

The activation depends on, but does not repeat or broaden, these accepted
boundaries:

- compatible authority preparation and live fixed functions;
- converted application source
  `e9239463a71860451191344b26dd20b45298f239` on current deployment
  `dpl_7PRTnXtMrMNq83ZFPJNeqFtyXZ8h`;
- signed Stripe test-mode linked-seller proof with stable exact replay and full
  disposable row/account cleanup; and
- predecessor drain from exact main
  `9947a9e485a686dc801befcdea285cddc5b3aff7`, CI `32583228592`, with evidence
  SHA-256
  `3bb83df87df2cf2571df53ef0021e73886eca5d57140e0e8bc929eac4e2b61b1`.

The tracked-source gate scans every application JavaScript/TypeScript file and
requires the exact three fixed-operation consumers with zero direct
`SellerPayoutEvent` access. It remains in CI after activation.

## Remaining release boundaries

Before production activation:

1. the real PostgreSQL CI activation and rollback proofs must pass from the
   exact candidate head;
2. full repository tests, Prisma validation/generation, TypeScript, lint,
   dependency audit and production build must pass;
3. the isolated branch must receive an Extra-High authority review and merge as
   one exact head;
4. production migration wiring must be separately authorized, reviewed and
   bound to the exact successful main CI run; and
5. the later actual pooled-runtime production postflight must run read-only and
   retain sanitized mode-`0600` evidence.

FORCE is deliberately absent. It will be a separate posture-only migration
after policyless activation and pooled-runtime evidence are accepted. The
remaining `OrderPaymentEvent`, `OrderShippingRateQuote`, `Order` and `OrderItem`
domains stay separate audits and releases; this candidate does not authorize or
bundle them.
