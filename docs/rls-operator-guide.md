# Operating Grainline RLS Without Codex

Last reviewed: 2026-07-26

This is the plain-English map for safely operating the RLS rollout without
relying on an agent's memory. It explains what the machinery does, what a
failure means, and how to prepare a new reviewed phase. It does not authorize a
production migration.

## Safety model

Grainline uses application authorization first and PostgreSQL RLS plus narrow
database functions as defense in depth. The production application connects
through the pooled `DATABASE_URL` as the non-owner
`grainline_app_runtime` role (`NOINHERIT NOBYPASSRLS`). Protected migration jobs
use the direct owner credential stored outside Vercel runtime.

Never put the owner URL in application or Preview variables, and never use an
owner session as proof of runtime RLS behavior.

Sensitive groups activate separately: SavedSearch; Notification; Conversation
and Message together; Case and CaseMessage; Order/payment;
shipping/fulfillment; and the remaining user-owned groups. Passing one group
does not authorize another.

At this review date SavedSearch and Notification have production `ENABLE` plus
`FORCE ROW LEVEL SECURITY`. Conversation/Message compatibility, invariants,
legacy cleanup, fixed-function authority, application conversion and initial
RLS activation are also live and accepted. Exact main
`448d5233`, protected migration run `30194195844`, and authenticated pooled-
runtime operator `f474e761` prove ENABLE plus NO FORCE, exactly two SELECT
policies, direct runtime SELECT only, direct DML denial, route isolation and
exact cleanup. Sanitized mode-`0600` evidence SHA-256 is
`1f38671673e8040b222fcb620f8875c94cd47684969d423e6f260fc7a520e141`.
FORCE is not yet live. Its isolated candidate is
`20260726140000_force_conversation_message_rls`, SHA-256
`ba7408ede5a63f9cc10531f2598cb0b1187441d7157dc600d5518cd327dcf42f`,
under phase `conversation-message-force-reviewed`. Fresh PostgreSQL CI,
Extra-High acceptance, exact-main protected migration and pooled-runtime
postflight are still required. Reverify live state before repeating these
claims.

## Tool map

| Tool | Purpose | A pass does not mean |
|---|---|---|
| `scripts/guard-saved-search-rls-deploy.mjs` | Pins the exact reviewed migration inventory, SQL bytes, predecessor phases, latest migration, and absence of provider-runner artifacts. | The SQL behaves correctly or production is authorized. |
| `npm run verify:rls-release-artifact` | Runs that guard for `SAVED_SEARCH_RLS_DEPLOY_PHASE`. | The operator chose the right phase. |
| `.github/workflows/production-migrations.yml` | Manual protected migration runner: exact `main` SHA, owner identity, artifact guard, migration status, and final grant/RLS audit. | Application code was deployed or authenticated UI works. |
| `scripts/guard-production-migration-runner.mjs` | Refuses non-main, non-manual, SHA-mismatched, pooled, or wrong-role jobs. | A new migration was reviewed. |
| `scripts/audit-runtime-db-grants.mjs` | Compares live roles, ownership, grants, functions, policies, FORCE, default privileges, and source inventory to the contract. | Business rules or arbitrary-code-compromise resistance are proven. |
| `scripts/provision-runtime-db-role.sql` | Converges runtime least privilege; private trigger/core functions stay runtime-ungranted. | It is safe to paste into an unverified database. |
| `scripts/conversation-message-rls-inventory.mjs` | Pins every direct Conversation/Message ORM and raw SQL path. | A stable count makes each path safe. |
| `scripts/conversation-message-invariant-proof.mjs` | Loopback PostgreSQL 16 proof for constraints, private trigger ACLs, valid runtime writes, forged-route denial, and lock races. | Production was touched, production is proven, or RLS is active. |
| `scripts/verify-conversation-message-authority-release.mjs` | Pins the promoted 25-function migration and proves its executable body matches the accepted disposable candidate. | The migration is merged, applied, or RLS is active. |
| `scripts/conversation-message-authority-production-postflight.mjs` | Read-only proof through the exact pooled production runtime after functions-only migration: release binding, 25 function ACLs, six private-core denials, old CRUD retained, and RLS/policies still off. | Application conversion, table-grant activation, RLS, or FORCE is complete. |
| `scripts/conversation-message-compatibility-production-postflight.mjs` | Preserves the authenticated RLS-off compatibility proof and adds `--post-activation` mode for the exact live release. The latter proves pooled-runtime posture, exact policies/grants, context-empty isolation, direct DML denial, authenticated inbox/thread/list/unread/read behavior, foreign denial, cleanup, and zero notification/email side effects. | FORCE is complete or arbitrary runtime code execution cannot choose a custom PostgreSQL setting. |
| `scripts/stage-conversation-message-activation-migration.mjs` | Byte-pins the accepted two-policy source and builds the exact disposable initial-activation candidate with predecessor and postflight catalog guards. | Production is authorized or changed. |
| `scripts/verify-conversation-message-activation-release.mjs` | Pins the promoted activation bytes and proves the executable body equals the generated disposable candidate. | PostgreSQL behavior, runtime authentication, or production activation is proven. |
| `scripts/conversation-message-activation-rollback-proof.mjs` | Loopback-only proof that initial activation can be disabled, old CRUD restored, fixed functions retained, and the exact initial activation restored with zero fixture residue. | A production rollback was performed or FORCE is safe. |
| `scripts/verify-conversation-message-force-release.mjs` | Pins the accepted activation baseline and exact FORCE-only migration bytes and rejects policy, grant or row-DML drift. | The migration has run in PostgreSQL, merged, or changed production. |
| `scripts/conversation-message-force-rollback-proof.mjs` | Loopback-only proof that committed `NO FORCE` preserves RLS, policies, SELECT-only grants and context-empty denial, then restores exact FORCE. | A production rollback occurred or the live pooled runtime was tested. |

## Deploy-phase lifecycle

`SAVED_SEARCH_RLS_DEPLOY_PHASE` began with SavedSearch and now selects the
global exact reviewed migration tree. Its name is misleading, but renaming it
mid-rollout would change workflows, tests, commands, and operator expectations.
Rename it only in a separate reviewed maintenance change.

Current values:

| Value | Exact purpose |
|---|---|
| `release-0` | SavedSearch owner RPC preparation |
| `phase-a-reviewed` | Initial SavedSearch RLS |
| `phase-b-reviewed` | SavedSearch FORCE |
| `notification-preparation-reviewed` | Notification schema/function preparation |
| `notification-activation-reviewed` | Initial Notification RLS/grants |
| `notification-force-reviewed` | Notification FORCE |
| `conversation-message-compatibility-reviewed` | Nullable listing context and compatible read indexes |
| `conversation-message-invariants-reviewed` | Conversation/Message invariants and body-search index, with RLS still off |
| `conversation-message-legacy-cleanup-reviewed` | At most one fully source-bound legacy custom-order-link context repair, with RLS still off |
| `conversation-message-authority-preparation-reviewed` | Promoted fixed authority functions and exact ACLs while old runtime table CRUD and RLS-off compatibility remain |
| `conversation-message-activation-reviewed` | Initial paired Conversation/Message ENABLE plus explicit NO FORCE, exact SELECT policies, and runtime SELECT-only table grants |
| `conversation-message-force-reviewed` | FORCE-only hardening for the already activated Conversation and Message tables; policies, grants, functions and rows must remain unchanged |

The phase is not a feature flag. It is exact-artifact human authorization and
must fail when migration bytes or order change.

## Normal workflow

1. Begin from a clean branch at exact current `main`.
2. Audit the product area before RLS. Fix existing authorization, lifecycle,
   race, pagination, and data-shape defects first.
3. Inventory every read/write and non-user actor: webhook, cron, staff, export,
   deletion, cleanup, metrics, and notification source validation.
4. Inspect legacy production data through a protected aggregate-only,
   read-only workflow. Retain no payloads, emails, credentials, or row ids.
5. Land additive compatibility work before restrictions when old and new app
   instances must coexist.
6. Prove direct denial, valid paths, forged targets, ACLs, context isolation,
   cleanup, and races in disposable PostgreSQL.
7. Add a new exact guard phase rather than weakening or reusing an old phase.
   Pin predecessor migrations, reviewed latest migration, full tree hash,
   required artifacts, forbidden temporary artifacts, and expected
   RLS/FORCE/grants.
8. Update guard tests, production workflow, runbook, group plan, and authority
   inventory together.
9. Open a draft PR so CI runs against PostgreSQL 16. Do not merge until proof
   and ordinary tests pass.
10. Perform a high-scrutiny SQL and function-authority review.
11. Merge only the tightly coupled preparation group.
12. Manually dispatch the protected migration workflow with the exact merged
   40-character `main` SHA and confirmation text.
13. Deploy the compatible application separately when sequencing requires it.
14. Run authenticated route smoke and direct runtime-role/grant/catalog
   postflight. Retain sanitized mode-`0600` evidence outside Git.
15. Activate RLS and later FORCE only through their separately reviewed phases
   when the group plan requires that split.

## Reading guard failures

| Failure | Meaning | Response |
|---|---|---|
| Phase missing/unknown | No exact authorization. | Stop and identify the intended release. |
| Tree fingerprint changed | Migration added, removed, renamed, or edited. | Review the complete tree and SQL diff before repinning. |
| Reviewed migration is not latest | A later migration entered the tree. | Decide whether it belongs or must ship separately; do not casually reorder it. |
| Predecessor missing | Branch lineage is wrong. | Reconcile with current `main`; never manufacture placeholders. |
| Context-gate/runner artifact found | Provider-only code could reach production. | Remove the route, middleware exemption, marker/test, and related secrets. |
| Database identity failure | Wrong database, pooled URL, owner, or runtime role. | Stop and correct credential selection without printing it. |
| Grant/RLS audit failure | Live authority differs from contract. | Preserve sanitized evidence and ship a reviewed forward fix. |
| Prisma migration failure | Migration ledger may be failed or partial. | Stop; inspect protected migration status and prefer a reviewed forward repair. |

Never change a hash merely to silence the guard, weaken the Vercel runtime
database guard, migrate during an application build, use `prisma db push` on
production, retroactively convert failed evidence to passing, publish secrets
or customer payloads, or bundle unrelated sensitive groups.

## Evidence map

- Strategy and named deferrals: `STRATEGY.md`
- Runtime/migration role plan: `docs/db-defense-in-depth-plan.md`
- General commands and failure handling: `docs/runbook.md`
- Launch evidence: `docs/launch-checklist.md`
- Site-wide dispositions: `docs/rls-coverage-matrix.md`
- Group plans: `docs/rls-*-plan.md`
- Authority inventories: `docs/*authority-inventory.md`
- Scaling triggers: `docs/scaling-decisions/`
- Audit history: `CLOSED_AUDIT_HISTORY.md` and
  `CLOSED_AUDIT_ARCHIVE*.md`
- Environment-specific sanitized artifacts: designated external evidence
  directory, mode `0600`, never Git

Record exact commit SHA, workflow/deployment id, migration names, database
identity classification, roles, pass/fail, issue count, UTC timestamps, cleanup,
and residual risk. A later pass never erases earlier failed evidence.

## Rollback and emergencies

Preparation should be additive and old-app compatible. Database-first rollback
is safe only when every currently serving app version can operate on the
rolled-back authority/schema. Never drop a column or function referenced by a
live deployment.

During an incident: stop promotion, preserve bounded evidence, identify the
exact live app SHA/migration ledger/roles/policies/grants/old deployments,
choose the smallest reviewed forward fix unless a tested rollback is safe,
rerun runtime/grant/health/authenticated proof, and document the preventing
guardrail. An emergency does not justify an owner runtime connection or
site-wide RLS disablement.

## Retiring or renaming the guard

Do this only after no active rollout depends on the old phase. Inventory every
workflow, script, test, runbook command, and provider variable; introduce the
replacement name without weakening exact-tree checks; update CI/production
workflow tests; document permanently completed phases; and prove both a clean
current audit and a rejected synthetic drift.

Do not keep historical phase values executable forever. After a successor is
live with retained evidence and the old phase cannot legitimately run again,
move its history to documentation and keep only current/future release states
in code.
