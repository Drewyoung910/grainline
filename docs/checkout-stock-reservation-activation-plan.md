# CheckoutStockReservation policyless activation plan

Status: isolated stacked design after compatible-authority PR #191. The PR is
unmerged and production remains unchanged. This plan and its draft SQL do not
authorize a merge, deployment, production migration, RLS/grant change, cleanup
or provider mutation.

Date: 2026-08-10

## Decision

`CheckoutStockReservation` is an owner-operated service ledger, not a table
that buyers, sellers or staff should query directly. Phase A therefore uses:

- `ENABLE ROW LEVEL SECURITY`, without `FORCE`;
- zero policies;
- zero ordinary-runtime or PUBLIC table/column privileges;
- runtime `EXECUTE` only on the 15 reviewed reservation operations and the
  source-bound three-argument webhook-begin overload;
- owner-private trigger, validation, restore and source-binding helpers.

This is intentionally different from recipient-owned tables such as
Notification. Adding buyer/seller row policies would expose internal checkout
locks, payload hashes, repair state and Stripe session identifiers while also
failing to authorize the cross-user webhook/repair operations safely.

## Exact predecessor gates

The activation draft refuses to run unless all of these remain exact:

1. The reviewed owner holds the table and no other owner sessions remain in
   the database.
2. `grainline_app_runtime` is LOGIN, NOINHERIT, non-privileged and NOBYPASSRLS,
   with only the proven non-effective Neon bootstrap membership.
3. RLS and FORCE are off, there are zero policies, compatible runtime CRUD is
   still present, and PUBLIC/runtime column ACLs are absent.
4. The five non-primary validated checks, exact nine-index definitions and the
   sole reviewed normalization trigger exist; extra or name-only catalog
   lookalikes are rejected.
5. All rows satisfy the same lifecycle, actor, item, restoration and repair
   invariants enforced by the normalization trigger.
6. The complete 20-function authority catalog has exact signatures, owner,
   PL/pgSQL/security/search-path/volatility/parallel attributes, source MD5s
   and runtime/PUBLIC ACLs.

The migration uses bounded statement/lock timeouts, one advisory transaction
lock and an ACCESS EXCLUSIVE table lock so a conflicting deploy fails and can
be retried instead of partially changing authority.

## Compatibility and rollback

The compatible application must deploy first and predecessor versions must
drain before Phase A. The activation removes direct table authority, so an old
instance that still uses Prisma reservation delegates would fail immediately.
The database-first rollback disables RLS and restores only SELECT, INSERT,
UPDATE and DELETE to the runtime role before any application rollback.

Runtime-role provisioning accepts exactly two stable states:

- clean compatible predecessor: RLS/FORCE off and zero policies;
- policyless activated state: RLS on (with FORCE either off or, later, on) and
  zero policies.

It refuses partial posture and, in the activated state, revokes the broad
table grant again inside the provisioning transaction.

## Proof and release sequence

1. Merge compatible-authority PR #191 only after exact-head CI.
2. Run the compatible production migration and pooled-runtime postflight.
3. Deploy the fixed-operation application and exercise creation, bind,
   completion, restore, repair, resume, export and deletion paths.
4. Prove predecessor deployments drained and rerun the aggregate-only legacy
   inspection.
5. Promote the byte-pinned Phase-A migration in its own PR and CI proof.
6. Apply Phase A, converge grants, and run pooled-runtime direct-denial plus
   fixed-operation proofs.
7. Prepare and execute FORCE as a separate posture-only release.

No activation step is wired to the production migration workflow at this
checkpoint.

## Isolated proof checkpoint

Disposable PostgreSQL now executes the complete boundary from the exact
compatible authority predecessor: policyless ENABLE, direct runtime table
denial, successful fixed-operation read, private-helper denial, and
database-first rollback restoring only SELECT/INSERT/UPDATE/DELETE. Six
fail-closed tamper cases prove no partial activation on explicit column ACLs,
invalid lifecycle rows, extra triggers, same-named index or constraint
lookalikes, and leaked private-helper EXECUTE. Static and engine-focused tests
pass 41/41.

That proof exposed and closed three pre-release defects recorded as CSR-A23
through CSR-A25: table authority being misread as a column ACL, invalid PUBLIC
role-name privilege inquiry, and name-only trigger/index/constraint catalog
checks. The activation remains draft-only and production-inert.
