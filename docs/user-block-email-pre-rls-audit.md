# User block and email authority pre-RLS audit

## Scope and exact source

This audit covers reciprocal block filters, the current owner's blocked-account
page, block/unblock lifecycle serialization, and account email fallback reads
used by export and deletion. The isolated branch is based on local stacked
source `ca81d9ccc84693afe124d5853dc9c59107083261` after the seller, public-blog,
and public review/commission source packages.

The scope excludes staff User projections, seller follower/broadcast delivery,
installed Production catalog reconciliation, service ledgers, table-grant
revocation, policies, and User RLS activation.

## Intended behavior

- A viewer's public filters exclude both users they blocked and users who
  blocked them. Deleted accounts do not contribute filter targets.
- Each returned counterpart may include its current seller-profile id so
  listing and seller filters retain their existing behavior without a second
  broad relation read.
- The blocked-account page lists at most the owner's 50 newest outgoing block
  relationships and retains the existing public avatar/name fallback.
- Block and unblock lock the exact actor/target User pair in sorted order at
  `READ COMMITTED`, preserving the existing conflict with notification
  creation's sorted `FOR SHARE` lock and reciprocal block check.
- Block creation requires two distinct, existing, nondeleted users. Unblock
  remains idempotent for an existing pair and does not create authority over a
  different actor's relationship.
- Account export and account deletion derive fallback addresses only for the
  transaction-local owner. They retain current and historical exact addresses,
  then exclude any address whose exact or Gmail-normalized suppression key is
  claimed by another nondeleted account.
- Direct runtime access to `User` remains unchanged in this additive package.
  `UserEmailAddress` remains under its accepted FORCE posture.

## Measured boundary

Before this package, the exact scanner reported zero direct delegates, 28
visible User relation edges in 13 files, and three raw User SQL calls in three
files. This package removes five relation edges from
`src/app/account/blocked/page.tsx` and `src/lib/blocks.ts`, plus the raw User
calls in `src/lib/blockMutationAccess.ts` and
`src/lib/userEmailAddresses.ts`.

The resulting exact source frontier is zero direct delegates, **23 relation
edges in 11 files**, and **one raw User SQL call in one file**. The remaining
raw call is the background follower count in `src/lib/quality-score.ts`.

## Authority matrix

| Operation | Principal | Required result | Boundary |
| --- | --- | --- | --- |
| Read reciprocal block targets | Current active owner | Deduplicated counterpart User ids and optional seller ids | Transaction-local `app.user_id`; fixed `grainline_user_block_targets()` |
| Read blocked-account page | Current active owner | Newest 50 outgoing relationships with bounded public labels | Transaction-local `app.user_id`; fixed `grainline_user_blocked_account_page()` |
| Create block | Current active actor | One actor-owned relationship for an existing active pair | Sorted fixed pair lock, then existing unique-key upsert in the same `READ COMMITTED` transaction |
| Delete block | Current active actor | Delete only the actor's exact outgoing relationship; missing row is harmless | Same sorted fixed pair lock, then actor/target `deleteMany` |
| Read fallback email addresses | Current owner during export or deletion | Owner current/history addresses minus active-account collisions | Argument-free fixed owner function under transaction-local context |
| Read another user's email or block page | Any ordinary runtime caller | Denied or empty outside the caller's own context | No target-user argument; context is set only by `withDbUserContext` |

## Concurrency and failure review

`grainline_user_block_pair_lock(text)` validates the actor context and target,
rejects self-targeting, requires `READ COMMITTED`, selects exactly the two User
rows in stable id order, and takes `FOR UPDATE`. The application additionally
requires two distinct returned ids. This retains the notification/block
serialization protocol and prevents reverse-pair lock-order deadlocks.

The read functions fail closed when `app.user_id` is absent or malformed. The
reciprocal target function requires a nondeleted actor and counterpart. The
blocked-account page intentionally retains outgoing relationship rows even if
the target later becomes deleted so the owner can still remove the block.

The email authority accepts no user id or candidate-email arguments. It derives
both from `User` and `UserEmailAddress`, calculates the same canonical Gmail
suppression keys as the existing uniqueness boundary, and checks only the
current email of other nondeleted User rows, matching the prior collision rule.

All four functions are `SECURITY DEFINER`, use
`SET search_path = pg_catalog`, revoke PUBLIC execute, and grant only ordinary
runtime execute. Canonical provisioning and the explicit User authority catalog
contain the same four signatures.

## Findings and decision

### `BLOCKS_RLS_DESIGN`: block filters and the blocked-account page traversed User

The shared block helper and account page depended on broad Block-to-User and
SellerProfile relations. A general User read policy would expose unrelated
identity and account state. Owner-scoped fixed projections replace those
relations without expanding output.

### `BLOCKS_RLS_DESIGN`: block mutation serialized on raw User rows

The lock is required for notification race safety, so it cannot simply be
removed. The fixed pair-lock function preserves the exact lock order while
binding the actor to transaction context.

### `BLOCKS_RLS_DESIGN`: export and deletion probed arbitrary User email keys

The prior helper accepted a user id and candidate list while querying other
User rows. The new argument-free owner function derives the candidates and
collision scope inside the database.

**GO for one isolated additive block/email authority migration and source
conversion. NO-GO for publication, Production SQL, deployment, User grant
revocation, policies, ENABLE RLS, or FORCE RLS.**

The source gate is the focused caller tests, TypeScript, exact indirect scanner,
disposable PostgreSQL behavior/ACL proof, canonical catalog/provisioning proof,
CI isolation after the review/commission and accumulated-access predecessors,
and a clean diff.

## Local implementation checkpoint (2026-10-07)

The four operations and caller conversions are implemented in the isolated
worktree. The disposable PostgreSQL proof passes all five behavior, context,
direct-table-denial, and PUBLIC-privilege cases. The exact scanner confirms the
23/11/1 frontier. CI restores and applies this package only after the public
review/commission and accumulated-access predecessors, verifies the exact
four-function catalog and unchanged RLS posture, then runs the canonical grant
audit. Publication and all Production effects remain separate decisions.
