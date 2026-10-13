# User opaque-query review

Date: 2026-10-11

## Purpose

The User indirect-access scanner deliberately reports query shapes it cannot
evaluate statically. Those reports are review leads, not confirmed User table
dependencies. This review closes the current opaque-source gate without
weakening the scanner or claiming that an opaque count of zero is required.

The reviewed source has zero direct User delegates, zero visible User relation
edges, zero static raw User SQL calls and zero typed-factory User relations.
The remaining scanner output is 220 caller shapes and 14 typed factory-return
shapes.

## Classification

The 220 caller shapes divide into:

- 185 calls to reviewed visibility, lifecycle-snapshot or scalar-ownership
  helpers, representing 152 unique line-independent signatures;
- 35 residual shapes, representing 29 unique signatures, consisting of scalar
  cursor and ownership filters, sort specifications, mutation payload builders,
  deletion/retention queue filters and already-reviewed lifecycle snapshot
  helpers.

The AccountDeletionSideEffect claim-fence conversion removed two reviewed
residual ORM shapes and added none: its per-URL media enqueue payload is now a
claim-bound SQL RPC, and its claimable-row update predicate is now an atomic
claim RPC. The reviewed helper and typed factory sets are unchanged.

The 14 typed factory-return shapes are generic `extra`/`where` inputs and one
conditional scalar seller-id filter. Their implementations were read directly.
Public listing, seller, blog, commission and favorite helpers use durable
`ownerAccountActive`, `authorAccountActive` or `buyerAccountActive` snapshots.
Cart, saved-blog and saved-search helpers bind scalar `userId` columns. None of
the reviewed shapes introduces a hidden User relation, direct User delegate or
raw User SQL access.

The SellerProfile private-boundary caller conversion moved the reviewed Guild
revocation predicate from its cron route into `sellerGuildPrivateAccess.ts`
without changing the predicate, and replaced two opaque Stripe-version helper
fragments with the scalar `stripeAccountSupported` snapshot. The signatures
below record that reviewed source move and the smaller factory frontier.

## Change-detection proof

`tests/user-opaque-query-review.test.mjs` canonicalizes each shape as
file/model/path/factory/expression, removes line numbers and normalizes
whitespace. It pins these reviewed sets:

| Set | Rows | Unique signatures | SHA-256 |
|---|---:|---:|---|
| Reviewed helper call sites | 185 | 152 | `a2d6479ba3a3502e7c59181008c4a65aaf577d67702a7c9bf402ef7543fe4662` |
| Reviewed residual call sites | 35 | 29 | `4a341e6c1b8003c634ced1688756f084d41af10765e3c278c1310b50676a9fe9` |
| Typed factory-return shapes | 12 | 12 | `8be152475784c708b5045963749df829459dc7da639b6bcaec5bfeccc6ee64a2` |

Any added, removed or semantically changed opaque shape fails the focused test
and requires another source review. Separate assertions pin the lifecycle
snapshots and scalar ownership used by the shared helpers.

This is change detection plus manual semantic review. It does not prove dynamic
SQL assembled outside the scanner, installed database function bodies or
Production grants. The installed-catalog inspection remains responsible for
the database boundary.

## Decision

**The current opaque source frontier is reviewed and does not block User policy
design.** The service-ledger scope decision is closed in
`docs/user-service-ledger-separation-decision.md`; those ledgers remain separate
tracked hardening groups. Installed Production catalog reconciliation and final
User grant/policy design remain open. Any
opaque-signature change reopens this gate.
