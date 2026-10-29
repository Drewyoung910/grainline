# Block RLS Options

Date: 2026-10-28

Source: `857bc94706913a4d5c4368afa99de0a55bb2437c`

Decision: Option B accepted on 2026-10-29 for long-term privacy, safety, and
scalability. Reverified against exact main
`fb38730ff86f85a9b1dbd5bba39cbddd54af9108`; no Block runtime consumer changed.

This comparison follows `docs/block-pre-rls-audit.md`. Block is an asymmetric
safety relation: both endpoints need silent enforcement, but only the blocker
may see and manage the explicit record.

## Option A: Bidirectional Read Policy, Blocker-Owned Writes

Grant SELECT when the actor is either endpoint, INSERT/DELETE when the actor is
the blocker, and no UPDATE.

Advantages:

- a compact, conventional policy set;
- actor-scoped pair checks can use ordinary SQL under transaction-local
  context;
- outgoing block management maps directly to the blocker column.

Costs and risks:

- incoming SELECT reveals who blocked the actor, direction, timestamp and row
  identity;
- every service function still needs a BYPASS owner or separate service role;
- generic INSERT cannot safely own the pair lock and dependent cleanup;
- many server routes still need conversion to transaction-local context;
- a missing context looks like "not blocked," which is unsafe for early app
  checks unless every final authority independently rechecks.

This option is rejected because it weakens the current safety privacy contract.

## Option B: Zero Direct Runtime Authority With Fixed Operations

Revoke direct runtime access, ENABLE and FORCE policyless RLS, and expose only
purpose-bound functions. Retain the existing target/page/pair-lock and
cross-domain service functions. Add or consolidate:

- an actor-bound boolean pair check;
- one atomic block-create transition that also removes Follow and
  StockNotification rows;
- actor-bound unblock;
- actor-bound export;
- target-context outgoing-only deletion cleanup.

Advantages:

- incoming direction and metadata never become generic runtime-readable data;
- block creation owns its complete lock and cleanup invariant;
- current cross-domain functions already perform the difficult source and
  participant checks;
- new callers must choose an intentionally narrow safety operation;
- no broad service policy or fragile session role is needed.

Costs and risks:

- every current installed function that reads Block becomes part of the
  retained function-owner/ACL catalog (45 at the audited full-chain source);
- two runtime messaging projections are currently `SECURITY INVOKER` and must
  stop reading `Block` directly before policyless activation;
- five application operations need conversion or consolidation;
- behavior drift is possible unless replacements are compared with the exact
  predecessor in awkward cases;
- function ownership and fixed search paths are security-critical.

Rollback restores predecessor CRUD before disabling/removing the new boundary.
No row or column is dropped.

## Option C: Split Out A Symmetric Pair-Denial Projection

Keep blocker-owned Block rows private and maintain a second normalized pair
table containing only sorted user IDs for fast symmetric enforcement.

Advantages:

- ordinary enforcement can query an undirected pair without revealing who
  initiated the block;
- pair lookups become simple and indexable;
- the blocker-owned record remains suitable for account management.

Costs and risks:

- two tables must remain transactionally consistent across create, unblock and
  deletion;
- the pair table still reveals that some block exists if directly readable;
- cross-domain service functions and mutation cleanup remain necessary;
- backfill, reconciliation and rollback add substantial machinery for no
  measured performance need.

This may be useful only if pair-check volume later outgrows the two existing
directional indexes. It is not the safest launch activation.

## Option D: Column-Level Privileges

Expose the two user ID columns while withholding timestamps and row IDs.

This is not recommended. The two IDs still reveal direction, Prisma query
shapes become brittle, writes and cleanup remain unsolved, and cross-domain
service readers still need broader authority. It is not a meaningful safety
boundary.

## Recommendation

Choose **Option B**. This option is accepted.

Block is a poor fit for a generic row policy because enforcement is symmetric
while disclosure and management are asymmetric. The app already routes most
cross-domain reads through fixed authorities, so zero direct access closes the
privacy boundary with less new behavior than a second projection table.

Required safeguards:

- make block creation plus Follow/StockNotification cleanup one locked atomic
  transition;
- preserve the current principal rule: the blocker must be active, while a
  distinct non-deleted target may still be blocked even if suspended;
- preserve outgoing-only account management and outgoing-only deletion;
- keep general pair enforcement boolean/undirected;
- preserve the current export until separate legal review;
- catalog every installed Block-reading function from the full migrated
  database and reject unclassified functions;
- preserve blocked-pair filtering in inbox and unread projections without
  retaining direct runtime table access or exposing a generic pair oracle;
- full-chain PostgreSQL 17 race, paid-checkout, account-deletion, function-owner
  and rollback proofs;
- no column drop, pair projection or product-semantics change in the security
  release.

Compatible preparation may proceed in isolation. Production activation still
requires its own exact approval after the full behavior, race, rollback, and
installed-function catalog proofs pass.
