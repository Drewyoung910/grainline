# SellerPayoutEvent policyless activation release

Status: accepted production policyless Phase A. Exact main
`bf9f353ed1d94f4d32933b5d6417a75f4c0f625e`, CI `32663849012`, guarded
migration run `32667518275`, and the separate actual pooled-runtime postflight
passed. RLS is enabled with explicit `NO FORCE`, zero policies and zero direct
runtime/PUBLIC table or column authority. Nothing in this document authorizes
deployment, provider change, another migration, or the later FORCE release.

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

The separate production acceptance postflight accepts only the exact clean
release commit, exact main-CI and
migration-run bindings, the reviewed pooled `grainline_app_runtime` target and
a fresh exact evidence path. It rejects privileged or aliased database URL
variables, connects as the actual runtime login without `SET ROLE`, and opens
an engine-attested repeatable-read read-only transaction. Inside that
transaction it verifies the restricted identity, owner role, policyless ENABLE
posture, exact function source/owner/mode/ACL catalog and zero unreviewed table
or column authority. It then proves direct table read denial, zero-row results
for both fixed recipient projections using an absent actor and SQLSTATE `25006`
when the fixed writer reaches PostgreSQL's read-only fence. It rolls back and
may write only a fresh, sanitized mode-`0600` evidence file containing a hash
of the database URL rather than the URL or credential.

CI applies the activation to disposable PostgreSQL and invokes the same
catalog and runtime-identity helpers through a new connection authenticated
directly as `grainline_app_runtime`. This real-engine postflight proof covers
the read-only transaction, direct denial, fixed read projections and writer
fence before the database-first rollback rehearsal restores the activation.

## Exact-head CI result

Isolated checkpoint `38d9acb1cf07cd772cc1fa23cc29024ff9f9dc95`
passed exact-head CI run `32590297568`. That run completed the real PostgreSQL
16 predecessor, activation, separate-login authority and database-first
rollback/restoration proofs; migration status and the global grant/RLS audit;
Prisma validation/generation; TypeScript; lint; the full repository suite;
dependency audit; and the production build. This was candidate evidence only;
production remained in the compatible predecessor posture.

Postflight-hardening checkpoint
`d5fa351247fcf28c736a760974f50f1718427281` then passed exact-head CI run
`32591448929` in 6m44s. The new disposable-PostgreSQL step authenticated
directly as the restricted runtime role and passed the production postflight's
catalog, direct-denial, fixed-read and SQL read-only-fence path before the
database-first rollback/restoration. The full type, lint, test, dependency and
production-build gates also passed. No production postflight or mutation ran.

The complete activation package then merged from exact head
`be061901523fb81edf88f59c0c8c86aa06457554` at main
`570aa8aa2690bcbd341ce08a9cabdcaaa8bcab3d`. Exact-main CI `32608753825`
passed the full PostgreSQL release chain, SellerPayoutEvent activation,
separate restricted-runtime authority, database-first rollback/restoration,
TypeScript, lint, full tests, dependency audit and production build.
Conversation/Message FORCE proof `32608753833` also passed. Notification FORCE
proof `32608753821` stopped before its authority assertions because its
cross-release `SellerPayoutEvent` fixture omitted the newly required
`stripeEventCreatedSeconds`; the isolated correction supplies a deterministic
valid provider-event time and adds a regression assertion. This was a CI
fixture compatibility defect, not a production migration or RLS failure. No
production postflight or mutation ran.

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

## Accepted production activation and remaining boundary

The first authorized dispatch `32659750056` stopped before Prisma or mutation
at the strict historical CheckoutStockReservation FORCE tree check. The
corrected production order merged at exact main
`bf9f353ed1d94f4d32933b5d6417a75f4c0f625e`; exact-main CI `32663849012`
passed. Guarded migration run `32667518275` applied only this activation,
converged the reviewed grants, and passed migration status, global grant/RLS
audit, and exact activation scope. The separate actual pooled-runtime
postflight passed all nine checks in an engine-attested
repeatable-read/read-only transaction and wrote sanitized mode-`0600` evidence
SHA-256
`01235ef9a0922d1d1b8feb17e53bf9bbf47589ef23c927a9e5e65312cebb27de`.
It reported `productionChangedByPostflight=false`.

FORCE is deliberately absent. It is the next separate posture-only migration
after this accepted policyless Phase A. The
remaining `OrderPaymentEvent`, `OrderShippingRateQuote`, `Order` and `OrderItem`
domains stay separate audits and releases; this candidate does not authorize or
bundle them.
