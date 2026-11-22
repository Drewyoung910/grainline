# Grainline RLS fast-track handoff

Updated: 2026-11-21 America/Chicago

This is the authoritative takeover record for the current Listing and Commission RLS chain. Read this file before changing, merging, releasing, or restacking any branch named below.

## Safety and authorization boundary

- The user authorized isolated preparation, review, commits, pushes, draft PRs, and continued CI repair.
- The user has **not** authorized merging these PRs, deploying an application build, running a Production migration, activating RLS in Production, changing credentials, or mutating provider settings.
- Green CI does not itself authorize any Production action.
- Treat Claude audit findings as allegations until independently verified.
- Before adding security or release machinery, ask whether it is necessary, useful, and worth its maintenance cost. Prefer cohesive domain batches and the existing shared release workflows.

## Main checkout warning

Do not stage, overwrite, reset, or clean the current main checkout. It contains unrelated user/agent work:

```text
## codex/next-security-upgrade-20261117
 M CLAUDE.md
 M next.config.ts
 M package-lock.json
 M package.json
 M tests/dependency-hygiene.test.mjs
 M tests/verified-audit-followups.test.mjs
?? .npm-cache/
?? audit_claude_session_20260908.md
?? docs/audits/
?? recovery-checkpoints/rls-fast-track-20261121/CURRENT-RLS-FAST-TRACK-STATE.md
```

The RLS work was kept in isolated clones under `/private/tmp`. Every code commit listed below is pushed to GitHub, so those clones are convenient but are not the only copy.

## Exact pushed chain

The intended dependency order is:

1. Listing preparation PR #765
2. Listing activation PR #766
3. Commission preparation PR #767
4. Commission activation PR #768

### Listing preparation

- PR: https://github.com/Drewyoung910/grainline/pull/765
- Branch: `codex/listing-domain-rebuild-20261117`
- Head: `38501e2f801064013f5d1a6753fffcef4482cd14`
- Base: `main`
- Local clone: `/private/tmp/grainline-listing-rating-parity-20261119`
- Migration: `20261102050000_prepare_listing_domain_authorities`
- Scope: cohesive preparation for `Listing`, `Photo`, `ListingVariantGroup`, and `ListingVariantOption`; app access moves to fixed bounded authorities while predecessor table posture remains available until activation.

Important fixes already included:

- Rating summaries and buckets exclude inactive reviewer accounts.
- Provisioning handles exact predecessor, active, DB-first rollback, and ledger-recovery states while failing closed on partial or drifted state.
- Listing activation and rollback policy hashes and exact column ACLs are pinned.
- The full-chain fixture derives its expected rating from stored fixture rows and now creates a genuinely inactive reviewer, allowing the database trigger to bind `reviewerAccountActive=false` correctly.
- `effect` is overridden to patched version `3.22.1` for GHSA-7589-6fvf-x4pw. Dependency hygiene pins that override and lockfile result. Prisma 7.10.1 still requests vulnerable Effect 3.20.0, so a Prisma-only upgrade does not fix the advisory.

Current CI evidence:

- Run `44985961571` on exact head `38501e2f8`.
- PostgreSQL 17 full-chain production parity: **green**.
- Dependency audit blocker is fixed on this exact head.
- Main CI test job: **red**. It ran the full test suite and exposed many app-contract/test mismatches after the Listing authority conversion. Representative groups include listing edit/stock/SEO/search consumers, review replies and rating summaries, photo/alt-text and upload paths, public card presentation, and some inherited order/adapter assertions.
- Do not blanket-update these assertions. Triage each failure as either a stale source-text test or a real behavior regression. The saved log from this run was `/private/tmp/listing-ci-44985961571.log` on the originating machine.

Local validation completed before the latest push:

- dependency hygiene: 13/13
- exact dependency audit: passed in the isolated dependency clone; a later local rerun in the Listing clone could not reach npm because the sandbox blocked DNS
- Prisma generate and validate: passed for the dependency change
- Effect TemplateLiteral regression: 5k and 10k adversarial inputs rejected immediately; a valid input passed
- Listing preparation PostgreSQL 17 full-chain: green in GitHub CI

### Listing activation

- PR: https://github.com/Drewyoung910/grainline/pull/766
- Branch: `codex/listing-domain-activation-20261118`
- Head: `72ad5a50bdfe9760ee5abcc1504a1c53521929f1`
- Base: `codex/listing-domain-rebuild-20261117`
- Local clone: `/private/tmp/grainline-listing-activation-20261119`
- Migration: `20261102060000_activate_listing_domain_rls`
- Scope: one atomic four-table public-read boundary; ENABLE plus FORCE RLS; exact public read policies and column ACLs; zero direct runtime writes; rollback and provisioning recovery are byte-sealed.

Validation after restacking onto Listing preparation head `38501e2f8`:

- focused static suites: 110 passed, 1 PostgreSQL-service skip
- `npx tsc --noEmit`: passed
- `git diff --check`: passed
- Independent review found the scalar subquery and recovery changes fail closed.
- GitHub had not reported exact-head checks at the time of this handoff. Do not infer readiness from the preparation PR's PostgreSQL run.

### Commission preparation

- PR: https://github.com/Drewyoung910/grainline/pull/767
- Branch: `codex/commission-domain-rebuild-20261119`
- Head: `8b6b34c4ba3bfe3a85dd3e352176d4c7e9a6c9eb`
- Base: `codex/listing-domain-activation-20261118`
- Local clone: `/private/tmp/grainline-commission-rebuild-20261119`
- Migration: `20261113010000_prepare_commission_domain_authorities`
- Migration SHA-256: `726c50fac1b9d9bd3568ea5534b9c3e8eab5f698611e15cb98efca9d0a9738bc`
- Scope: cohesive preparation for `CommissionRequest` and `CommissionInterest`; all application access is converted to 22 reviewed fixed operations while RLS remains off until activation.

Validation after restacking onto Listing activation head `72ad5a50b`:

- focused Commission/preparation/grant suites: 106 passed, 1 PostgreSQL-service skip
- `npx tsc --noEmit`: passed
- `git diff --check`: passed
- GitHub had not reported exact-head checks at handoff time.

### Commission activation

- PR: https://github.com/Drewyoung910/grainline/pull/768
- Branch: `codex/commission-domain-activation-20261119`
- Code head before this handoff document: `afd351d4217e367d1c334eb6f58622b61736a7ff`
- Base: `codex/commission-domain-rebuild-20261119`
- Local clone: `/private/tmp/grainline-commission-rebuild-20261119`
- Migration: `20261113020000_activate_commission_domain_rls`
- Migration SHA-256: `b84685453deef07f43cce445982eb6f0859ac9ee59442b5d4f0302d87525664f`
- Scope: one atomic policyless two-table activation; ENABLE plus FORCE RLS; zero direct runtime CRUD; retain 22 fixed authorities and retire exactly three superseded identity-taking entry points.

Six activation blockers were fixed:

1. Emergency rollback now checks exact owners, relation and column ACLs, function ownership/security/source hashes, and predecessor postflight before disabling RLS.
2. Provisioning accepts exact resolved rollback attempts, rejects unresolved attempts/checksum drift/duplicate success, requires one success in active posture, and permits zero or one success in predecessor posture for DB-first rollback recovery.
3. DB-first rollback intentionally leaves the global grant audit red until a forward migration reconciles the ledger; tests and documentation record this incident posture.
4. The PostgreSQL rollback proof runs in an outer disposable transaction and rolls back to the active full-chain state. It does not raw-rerun an already-applied activation.
5. CI isolates and restores Commission preparation and activation together and executes the move/restore rehearsal.
6. The full-chain PostgreSQL inspector maps `commission_domain_v1` to the activation state.

The activation catalog now pins Commission's compatible app ancestry to exact preparation head `8b6b34c4ba3bfe3a85dd3e352176d4c7e9a6c9eb`.

Validation after the final restack:

- focused activation/grant suites: 114 passed, 1 PostgreSQL-service skip
- ancestry/catalog rerun: 19/19 passed
- `npx tsc --noEmit`: passed
- `git diff --check`: passed
- Production remains NO-GO until exact-head PostgreSQL 16 and 17 CI passes and a separate production decision is made.

## Strict next actions

1. Start with PR #765 only. Read exact-head CI logs and triage every red test. Preserve runtime behavior; do not make tests green by deleting meaningful assertions.
2. When PR #765 is green, re-read the final diff and confirm its migration/catalog digests. Keep it draft until review is complete.
3. Trigger and verify exact-head CI for PR #766. Require real PostgreSQL 16 and 17 full-chain proof, activation inspection, rollback/provisioning state matrix, typecheck, lint, tests, build, and dependency audit.
4. Only after Listing is accepted should PR #767 be evaluated. Rebase/restack again if Listing's accepted head changes.
5. Verify PR #767 on real PostgreSQL, including all 22 fixed Commission operations, account export/deletion, ban/unban, expiry, public board/detail, interest/message creation, and malformed/terminal states.
6. Verify PR #768 on real PostgreSQL 16 and 17. Exercise predecessor, active, DB-first rollback, ledger recovery, partial activation rejection, function retirement, and exact ACL/owner/source checks.
7. Merges, application deploys, preparation releases, and activation releases require separate explicit authorization. Preserve this order: preparation merge/release, compatible app deploy, activation merge/release. Never allow multiple pending migrations to accumulate.

## Work after Listing and Commission

Apply the necessity/value filter before building any of these.

### AdminAuditLog

Rebuild on the accepted post-Commission base. Do not cherry-pick stale PR #761/#762 wholesale; each contains over 100 unrelated commits. Stale work may be used only as reviewed source material.

Required design fixes before implementation:

- avoid the global-before-domain lock inversion with account deletion
- prevent late redaction from preserving PII captured before the fence
- include both new Listing audit writers and Commission writers
- prove deleted-staff Case refund recovery, deleted-author moderation, two deleted accounts touching the same row, same-path mutation, and crash/retry behavior

### Analytics and service tables

- `ListingViewDaily` plus `SellerProfileViewDaily`: one cohesive private, policyless, zero-direct analytics batch; fix malformed telemetry fail-open behavior, prove indexes with real plans, handle zero-progress retention, and preserve lock order.
- `SellerExactMapConsentEvent`: least-privilege zero-direct design without cosmetic RLS; retention/legal decision is a prerequisite.
- `CronRun`: defer full RLS; a dedicated cron database role is the useful long-term control.

### Blog and reviews

- Blog: one lightweight hybrid `BlogPost` plus `BlogComment` batch with exact public reads and bounded private writes. Fix inline blog image reference tracking (#171) before enabling upload cleanup. Preserve User -> BlogPost -> DirectUpload and Notification -> BlogComment lock orders.
- Review: one cohesive `Review` plus `ReviewPhoto` hybrid batch. Keep public aggregates, bound private writes, harden seller replies, use a statement-level aggregate trigger, and reconcile active/block/visibility parity.

## UI and other work

The RLS chain must not absorb unrelated UI branches or the dirty main checkout. UI work and audit follow-ups can continue independently, but any release must be reviewed against the current production application and database migration state.

## What “safe to switch chats” means

It is safe to close the current Codex window once this file is present and PRs #765-#768 show the heads above (or a later handoff-only commit on #768). A new VS Code Codex chat will not inherit this conversation automatically. Its first instruction should be:

> Read `/Users/drewyoung/grainline/recovery-checkpoints/rls-fast-track-20261121/CURRENT-RLS-FAST-TRACK-STATE.md` completely. Verify the four PR heads and current CI state, preserve the dirty main checkout, then resume at Strict next actions step 1. Do not merge, deploy, or run a Production migration without separate explicit authorization.
