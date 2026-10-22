# SellerProfile public policyless FORCE release

Status: isolated source candidate. No Production FORCE operation is authorized
or applied by this document.

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
- proof that the compatible live application commit is an ancestor of the
  FORCE release commit;
- the exact compatible Vercel deployment still live;
- the immutable FORCE migration as the newest migration; and
- zero residual SellerProfile base-table consumers.

The restart-safe inspector admits only the accepted ENABLE or completed FORCE
state. The workflow permits only this migration to be pending, applies it once,
runs migration status and the global grant audit, and preserves sanitized
mode-0600 preflight/postflight evidence. It contains no application deployment,
alias change or inline FORCE statement.

## Production gate

Before dispatch, independently review the exact PR and confirm exact-main CI,
the compatible deployment, the accepted ENABLE run, and the migration checksum.
Production FORCE requires a separate one-word authorization for that concrete
workflow run. Until then Production remains at policyless ENABLE with NO FORCE.
