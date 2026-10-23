# SellerProfile public policyless FORCE release

Status: accepted in Production. Policyless FORCE is live.

## Production acceptance

Protected workflow run `39898441606` applied only migration
`20261020250000_force_seller_profile_rls` on 2026-10-22 from exact main
`b42cb4993e215bcc7ebaaa9816f4e27e1a50723c`. Exact-main CI run
`39895387544`, Conversation/Message FORCE proof run `39895387526`, accepted
ENABLE run `39869437488`, compatible application commit
`958b8c67970602908cd25a5d194838ffbb24e095`, and live Production deployment
`dpl_3APjbWpfPbzNpMrBqBZ8ga1e5gAB` were bound before database-owner access.

The retained postflight records public and private `SellerProfile` tables with
RLS enabled plus FORCE, zero policies, zero runtime/staff/PUBLIC table or
column authority, and both restricted roles remaining `NOBYPASSRLS` without
role memberships. It contains no row data. The evidence artifact
`seller-profile-force-production-39898441606` has digest
`sha256:5fc4f65a037df843bc3bb5120a14c36cf04406c87c37b86c74b77a9a2b34e4d4`.
The migration changed catalog posture only; the exact deployment binder,
complete migration status, global grant audit and live health check passed.

## Scope

Migration `20261020250000_force_seller_profile_rls` changes only the table-owner
bypass posture of public `SellerProfile`:

- requires the exact accepted ENABLE ledger checksum;
- requires a direct table-owner session whose role can bypass RLS;
- requires the two restricted runtime roles to remain login, membership-free,
  non-superuser and `NOBYPASSRLS`;
- requires public `SellerProfile` to be policyless ENABLE with NO FORCE and zero
  non-owner table/column authority;
- requires `SellerProfilePrivate` to remain policyless ENABLE plus FORCE with
  zero non-owner direct authority;
- applies `FORCE ROW LEVEL SECURITY` to public `SellerProfile`;
- repeats the direct-grant revocation; and
- reads back both public and private tables as policyless FORCE with zero
  non-owner authority in the same transaction.

It creates no policy, function, trigger or role; changes no row; and grants no
authority. The rollback uses `NO FORCE ROW LEVEL SECURITY` while retaining
policyless ENABLE and all direct-grant revocations.

## Evidence and CI contract

Focused executable tests prove the ENABLE predecessor, FORCE transition,
fail-closed behavior if a direct grant reappears, restricted-role denial, and
the database-first rollback. The PostgreSQL 16 full-chain proof checks the
policyless ENABLE boundary immediately before FORCE and the forced posture after
the complete migration chain. Main CI rebuilds the disposable database from the
full chain and runs the Production build against the forced schema.

The global grant auditor binds expected FORCE posture to the exact migration
ledger checksum. It rejects FORCE without ENABLE and continues to require zero
direct runtime/staff/PUBLIC authority.

## Protected Production workflow

`.github/workflows/seller-profile-force-production.yml` is the only reviewed
path. Before owner access it requires:

- exact current-main commit and successful exact-head CI;
- every required exact-main push workflow green;
- the accepted SellerProfile ENABLE production run and job;
- proof that the accepted ENABLE workflow commit is an ancestor of the
  compatible live application commit, which is itself an ancestor of the FORCE
  release commit;
- the exact compatible Vercel deployment still live;
- the immutable FORCE migration as the newest migration; and
- zero residual SellerProfile base-table consumers.

The restart-safe inspector admits only the accepted ENABLE or completed FORCE
state. The workflow permits only this migration to be pending, applies it once,
runs migration status and the global grant audit, and preserves sanitized
mode-0600 preflight/postflight evidence. It contains no application deployment,
alias change or inline FORCE statement.

## Production gate used

The completed run required independent review of the exact PR, exact-main CI,
the compatible deployment, the accepted ENABLE run and the migration checksum,
followed by separate authorization for the concrete workflow inputs. Keep this
same gate for any rollback or successor; do not treat the completed FORCE run as
standing authorization for another Production operation.
