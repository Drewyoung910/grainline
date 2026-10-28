# UserReport RLS Options

Date: 2026-10-28

Source: `857bc94706913a4d5c4368afa99de0a55bb2437c`

This comparison follows `docs/user-report-pre-rls-audit.md`. `UserReport` is
fully private, but its submitted, received, staff, service, export, and deletion
projections intentionally disclose different fields.

## Option A: Reporter-Owned Policies Plus Staff Policy

Allow an actor to SELECT rows they submitted, INSERT rows whose reporter id is
the actor, and allow staff to read/update all rows. Use a fixed projection for
reported-user export.

Advantages:

- fewer functions for the reporter-owned happy path;
- familiar owner-policy shape for submitted rows;
- no direct DELETE policy is needed.

Costs and risks:

- INSERT policy cannot safely validate ten polymorphic target families and
  their current visibility/ownership contracts;
- reporter SELECT exposes `resolvedById`, which the current export omits;
- staff policy depends on transaction-local context while the current shared
  runtime role and page queries do not establish a role-specific database
  session;
- the reported-user view still requires a separate narrow operation;
- account deletion, queue aggregation, resolution/audit, reported-thread access
  and notification source validation still require fixed operations;
- a caller that forgets the target-validation step can create false trust
  evidence even though the row policy passes.

This option is rejected because row ownership is not the hard authorization
problem in this table.

## Option B: Zero Direct Runtime Authority With Fixed Operations

Revoke direct runtime access, ENABLE and FORCE policyless RLS, and expose only
purpose-bound operations:

- actor-bound submit with target validation and attribution;
- actor-bound submitted and received export projections;
- PIN-gated application route plus active-staff queue and aggregate operations;
- atomic active-staff resolution plus audit witness;
- claim-bound account-deletion redaction/auto-resolution;
- retained exact notification and reported-thread service authorities.

Advantages:

- reporter narrative and identity cannot leak through a broad policy;
- every insert owns the full polymorphic target contract;
- submitted, received, and staff projections remain deliberately different;
- resolution and its audit witness share one database transaction;
- account deletion cannot select an arbitrary user or erase trust evidence;
- cross-domain services retain only their existing boolean/source-bound access.

Costs and risks:

- five direct-consumer modules require conversion;
- target validation spans several already-locked domains and must preserve
  their fixed authority contracts;
- the three installed service functions become part of the retained function
  catalog;
- behavior drift is possible unless the replacement is compared with every
  predecessor target and awkward deletion/export case.

Rollback restores predecessor CRUD before disabling/removing the new boundary.
No report row or column is dropped.

## Option C: Split Reporter Narrative From Moderation State

Move reporter-authored details into a private companion table while leaving
categorical target/status fields in `UserReport`.

Advantages:

- staff/status queries can avoid loading reporter narrative;
- deletion can redact the companion without changing the retained status row;
- separate retention could later apply to narrative.

Costs and risks:

- almost every `UserReport` field remains private, so the base table still
  cannot be generally exposed;
- insert, resolution, export, deletion and target validation remain fixed
  operations;
- two tables add join, backfill, transaction, rollback and consistency risk;
- there is no measured workload or legal decision requiring separate narrative
  retention today.

This adds machinery without reducing the core authorization problem.

## Option D: Column-Level Revocation Or Staff Read View

Revoke selected sensitive columns or expose a staff-oriented view while
retaining direct runtime table reads.

This is not recommended. Column grants cannot express reporter-versus-reported
perspectives, cannot validate target ownership, and cannot bind resolution to
its audit witness. A staff view also cannot distinguish a PIN-verified request
inside the shared runtime database role without the same actor-bound operation.

## Recommendation

Choose **Option B** after the correctness blockers in the pre-RLS audit are
fixed and independently proven.

`UserReport` is an intentionally asymmetric trust ledger, not a conventional
owner-only table. Policyless zero-direct access provides the clearest durable
boundary and reuses the existing service-authority pattern without adding a
second data model.

Required safeguards:

- fix message/review attribution before conversion;
- make every accepted target type investigable by staff or remove it;
- replace the newest-50 queue with a true count and stable oldest-first page;
- inventory production before adding categorical/state constraints;
- preserve the privacy-minimized resolution audit witness unless Drew chooses
  a different documented contract;
- preserve submitted/received export asymmetry and deletion retention;
- catalog every installed `UserReport` reader from the full migrated database;
- run full-chain PostgreSQL 17 lifecycle, cross-domain, concurrency, deletion,
  account-export, function-owner, direct-denial and rollback proofs;
- make no purge, legal-retention, target-deletion, or product-notification
  change in the security release.

Do not implement the migration or caller conversion until this option and the
resolution-audit contract are accepted. Preparation may then proceed in
isolation; production activation still requires its own exact approval.
