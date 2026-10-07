# User cross-domain authority convergence

Date: 2026-10-07

## Scope

This compatible pre-activation correction closes the final direct User-table
reads outside the reviewed User authority catalog. It does not enable or force
User RLS, revoke a User table grant, alter an application signature, deploy an
application, or authorize Production migration execution.

## Verified source finding

The ordinary application inventory correctly reached zero direct User Prisma
delegates, relation edges and raw SQL calls, but that inventory did not inspect
database function bodies owned by other RLS groups.

A chronological migration scan found two final invoker-mode dependencies:

1. `grainline_conversation_inbox(text,boolean,text,timestamp,text,integer)`
   directly joined User for participant `name` and `imageUrl`. Conversation and
   Message are already FORCE protected, so converting the whole inbox to
   definer mode would unnecessarily bypass their policies.
2. `grainline_case_resolution_claim_immutable()` read User from a private
   trigger while relying on the current definer caller. The trigger is bound to
   FORCE-protected `CaseResolutionClaim`, has no runtime or PUBLIC EXECUTE
   grant, and already has a pinned path, but its User access was implicit.

Four Case recipient projections that initially appeared similar are not open
dependencies. `20260730020000_converge_case_read_modes` already changed
`grainline_case_get`, `grainline_case_get_by_order`,
`grainline_case_staff_active_count`, and `grainline_case_export_page` to
definer mode without changing their bodies. Reading only their original CREATE
statements produced a stale conclusion.

## Compatible correction

Migration `20261007160000_converge_user_cross_domain_authorities`:

- pins the exact predecessor inbox body, invoker mode, owner, path and ACL;
- pins the exact installed
  `grainline_user_conversation_participants(text,text)` body, definer mode,
  owner, path and ACL;
- keeps the inbox invoker-mode and replaces only its direct User joins with one
  actor-and-conversation-bound lateral participant-authority call;
- preserves participant restriction, archive selection, reciprocal block
  exclusion, stable pagination, latest-message projection, unread count,
  listing preview and search behavior;
- pins the private CaseResolutionClaim table, trigger, body, owner, path and
  ACL, then changes only the trigger function's mode to definer; and
- postflights both exact function contracts inside the same transaction.

The inbox cannot use a generic public-profile helper: it needs labels for the
two exact participants, including inactive historical counterparties, without
creating an arbitrary User-id lookup surface. The existing conversation-bound
authority already implements that contract.

## Focused proof

`tests/user-cross-domain-authority-convergence.test.mjs` proves:

- exact predecessor and successor function hashes are pinned;
- the inbox remains invoker-mode and has no direct `public."User"` reference;
- the Case trigger body and private ACL remain unchanged while its mode becomes
  definer;
- a chronological scan of all migration function definitions and later mode
  changes leaves zero non-User-catalog direct User readers in invoker mode; and
- after direct runtime User access is revoked and policyless User RLS is
  enabled, direct User reads fail while the actor inbox still returns correct
  labels, unread count and name-search results and excludes a foreign thread.

The focused proof passed locally on 2026-10-07. Production remains unchanged.

## Release order

1. Merge the compatible source package after exact-head CI.
2. Apply only the convergence migration under an exact Production decision.
3. Retain sanitized catalog/readback evidence.
4. Build and prove the separate User Phase-A grant retirement plus ENABLE/NO
   FORCE migration.
5. Promote Phase A, drain predecessor execution, run pooled-runtime proof, and
   prepare the separate posture-only FORCE decision.
