# User RLS Release

Last updated: 2026-10-08

## Current Production State

The `User` table has accepted policyless ENABLE plus FORCE in Production.
There are zero policies, and the runtime, staff, and `PUBLIC` roles have zero
direct table or column authority. The application reaches the table only
through the reviewed fixed-function catalog.

Phase A is bound to:

- exact main `c9b02dfa530d3ca86b0ea7efd6f2f8e9e3b5233c`;
- first-attempt merged-main CI `37743008603`;
- cross-domain convergence run `37747092440`;
- complete pre-ENABLE catalog inspection `37747428986`;
- guarded ENABLE run `37747980060`;
- migration `20261008010000_enable_user_rls` with SHA-256
  `628f1cbb966cde1cb7f05f48ea0c5b890dce074d8f77536b3a67117c0141146f`.

The accepted postflight retained all 150 reviewed User readers as
security-definer functions and confirmed zero runtime/staff/`PUBLIC` direct
grants. The sanitized ENABLE evidence artifact digest is
`f2f6f4caba3c3dbec3df2847366c34c21f96f15f4837a42d88728baf6de0a208`.

## FORCE Acceptance

The distinct FORCE migration is `20261008020000_force_user_rls`, SHA-256
`d6e9e9afca641f527c4c120806c5af219d6b4f08936def91d16c348cff2480c3`.
It requires the exact accepted Phase A predecessor and changes only the User
table's FORCE flag. It creates no policy, mutates no application row, and
changes no grant.

FORCE was accepted from:

- exact main `85934f600f46c3e4b08046888d008970eaf8f171`;
- first-attempt merged-main CI `37763700848`;
- accepted ENABLE predecessor run `37747980060`;
- guarded Production FORCE run `37766247341`, attempt 1;
- typed confirmation `force-reviewed-user-rls`.

The Production preflight proved RLS enabled with FORCE off. The migration
ledger readback matched the exact migration and checksum with one applied
step. The postflight proved RLS enabled with FORCE on, zero policies, zero
runtime/staff direct CRUD grants, zero non-owner table or column ACLs, and all
150 reviewed readers retained as security-definer functions. The inspection
read no row data and rolled its read-only transaction back.

Sanitized evidence is retained with GitHub artifact digest
`1d46c8032bbfbaf426b1bc49d1cec35ed445fd4729c89275be69da736b4ea284`.
The downloaded postflight file has SHA-256
`8c48ef5100464799656df81d549dc94df507e52cd41d60fe0a2aa71d50d4e53c`.

## Completed Boundary

User policyless ENABLE plus FORCE is complete in Production. This acceptance
does not cover `ClerkWebhookEvent`, `AccountDeletionSideEffect`, or any other
table. Those remain separate matrix groups with their own audit, source,
runtime proof, and Production authorization requirements.
