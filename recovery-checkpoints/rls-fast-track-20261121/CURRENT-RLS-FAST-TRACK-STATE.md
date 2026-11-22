# Grainline RLS fast-track handoff

Updated: 2026-11-22 America/Chicago

This is the authoritative takeover record for the current Listing and Commission RLS chain. Read it completely before changing, merging, releasing, or restacking any branch below.

## Safety and authorization boundary

- The user authorized isolated preparation, review, commits, pushes, draft PRs, and continued CI repair.
- The user has **not** authorized merging these PRs, deploying an application build, running a Production migration, activating RLS in Production, changing credentials, or mutating provider settings.
- Green CI does not itself authorize any Production action.
- Treat external audit findings as allegations until independently verified.
- Before adding security or release machinery, ask whether it is necessary, useful, and worth its maintenance cost. Prefer cohesive domain batches and the existing shared release workflows.

## Main checkout warning

Do not stage, overwrite, reset, clean, or otherwise modify the current main checkout. It contains unrelated user/agent work.

Verified on 2026-11-22:

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
```

Main checkout HEAD: `1217b732118241804d3985e2b10a76379f9a4892`.

The main checkout also contains a stale, untracked/ignored local copy of this checkpoint at the same relative path. It was intentionally left untouched. Do not use that local copy for takeover; read the committed copy from the pushed #768 branch as described below.

The RLS work remains in isolated `/private/tmp` worktrees and all code heads below are pushed to GitHub.

## Exact pushed chain

Dependency order:

1. Listing preparation PR #765
2. Listing activation PR #766
3. Commission preparation PR #767
4. Commission activation PR #768

All four PRs remain drafts. None has been merged, deployed, or applied to Production.

### PR #765 — Listing preparation

- URL: https://github.com/Drewyoung910/grainline/pull/765
- Branch: `codex/listing-domain-rebuild-20261117`
- Head: `ad6f359a103dd91dc547e9806c7d43d3b40fd688`
- Base: `main`
- State: draft, mergeable
- Exact-head CI: run `45006695992`, fully green
- Focused validation: 147/147 passed
- Migration: `20261102050000_prepare_listing_domain_authorities`
- Migration SHA-256: `004e73153a49b88456b3eb078e2fe871c1f4f4998081146020f80d5f79babd3`
- Scope: cohesive preparation for `Listing`, `Photo`, `ListingVariantGroup`, and `ListingVariantOption`; app access moves to fixed bounded authorities while predecessor table posture remains available until activation.

Important accepted fixes include rating parity for inactive reviewers, exact predecessor/active/rollback/ledger-recovery provisioning, pinned activation and rollback policy hashes, exact column ACLs, and full-chain fixture correction.

Risk review: source and exact-head evidence support mergeability, but the migration, privileged boundary, persistent state, and architecture-specific rollout require human review. This is not merge authorization.

### PR #766 — Listing activation

- URL: https://github.com/Drewyoung910/grainline/pull/766
- Branch: `codex/listing-domain-activation-20261118`
- Head: `68909ff0d42a22259ec12d3895fa7c51d3fe86cf`
- Base: `codex/listing-domain-rebuild-20261117`
- State: draft, mergeable
- Exact-head CI: run `45012834401`, fully green
- PostgreSQL 16 and PostgreSQL 17 full-chain proofs: green
- Migration: `20261102060000_activate_listing_domain_rls`
- Scope: one atomic four-table public-read boundary; ENABLE plus FORCE RLS; exact public-read policies and column ACLs; zero direct runtime writes; byte-sealed rollback and provisioning recovery.
- Patch SHA-256 against #765: `06951dc5b9417bbafcdc4620f979398bd936ba749d15e54649c0c6d800d1e9ab`
- Activation migration digest: `49b7c1700d4db1cc6434a6bcaa2e6577df6c31fb762737553cfee62034c5b168`
- Rollback digest: `7033b6c3dbd664f802c2a16fb4c8300e236e08c5b25accbd675f09e5472b6f6a`

Risk review: mergeable with human review required; no merge or release has occurred.

### PR #767 — Commission preparation

- URL: https://github.com/Drewyoung910/grainline/pull/767
- Branch: `codex/commission-domain-rebuild-20261119`
- Head: `c10e7a978e649a841a194b793eb7a6b4c5528451`
- Base: `codex/listing-domain-activation-20261118`
- State: draft, mergeable
- Exact-head CI: run `45024618525`, fully green
- PostgreSQL 16 and PostgreSQL 17 full-chain proofs: green
- Full application checks: 5,993 tests, typecheck, lint, build, and dependency audit passed
- Migration: `20261113010000_prepare_commission_domain_authorities`
- Migration SHA-256: `2956d17b865b5755d3cd66825acc514a63f87fecf2bca563da0dcfae555ca21d`
- Patch SHA-256 against #766: `f6b4b720b684c9e556af3ce8c3d067629815f4d4f448c5213b6a5924816d7ec2`
- Scope: cohesive preparation for `CommissionRequest` and `CommissionInterest`; all application access is converted to 22 reviewed fixed operations while RLS remains off until activation.

Risk review: mergeable with human review required; no merge or release has occurred.

### PR #768 — Commission activation

- URL: https://github.com/Drewyoung910/grainline/pull/768
- Branch: `codex/commission-domain-activation-20261119`
- Code head under exact-head CI: `c78c7ff39aac948110b2e9a243c67185db9305df`
- Base: `codex/commission-domain-rebuild-20261119` (restored after the exact-head run)
- State: draft, mergeable
- Exact-head CI: run `45039134663`, fully green
- Main CI job: `137259422017`
- PostgreSQL 17 job: `137259422209`
- Migration: `20261113020000_activate_commission_domain_rls`
- Migration SHA-256: `b84685453deef07f43cce445982eb6f0859ac9ee59442b5d4f0302d87525664f`
- Current exact patch SHA-256 against #767: `e3542c73667c643425ed26925b60472ae17389f2be3399d0adcaa463ba7f422c`
- Scope: one atomic policyless two-table activation; ENABLE plus FORCE RLS; zero direct runtime CRUD; retain 22 fixed authorities and retire three superseded identity-taking entry points.

Fixes completed on the exact code head:

1. Corrected the full-chain psql interpreter so a marker comment between a query and `\\gset` is not treated as executable SQL; added a regression test.
2. Updated the retained SellerProfile Commission proof to require denial of the retired service target instead of expecting it callable.
3. Rebuilt the emergency rollback with correct per-function return types and exact source, owner, security, relation ACL, and column ACL checks.
4. Corrected Commission activation isolation and restoration in the CI fixture.
5. Extended the global grant audit to classify CommissionRequest and CommissionInterest as activated policyless FORCE tables and require the retired message-create authority to be runtime-ungranted.
6. Kept the new grant assertion strict for current sources while gating it out only for intentional historical-source rehearsals that predate Commission.

Local validation on this head:

- focused activation and grant suites: passed
- accumulated User access CI suite: 22/22 passed
- database grant inventory plus activation: passed (55/56, one expected service skip)
- `npx tsc --noEmit`: passed
- lint: zero errors; five pre-existing warnings
- `git diff --check`: passed
- disposable PostgreSQL 16: all 459 migrations applied, runtime provisioning passed, and exact runtime grant audit passed for 70 tables, 23 enums, 652 functions, one extension, 15 RLS policy tables, and zero sequence references
- rollback SHA-256: `1c3c261fba15245cd505183d063a9000453d941aec7261f7cd298a8570c2b2d5`

Run `45039134663` completed successfully at `2026-11-22T16:34:13Z`. PostgreSQL 16, PostgreSQL 17, the 5,993-test application suite, typecheck, lint, dependency audit, successor restoration, final exact runtime grant audit, and Production build all passed. Every auxiliary PR check also passed.

Patch-risk conclusion for the immutable range from #767 head `c10e7a978e649a841a194b793eb7a6b4c5528451` to this code head: source and exact-head evidence support `merge` with `human_review_required`. Impact is high if wrong, likelihood is low, regression protection is strong, recoverability is managed, and confidence is high. Automatic merge is excluded because this changes a privileged boundary, a migration, persistent state, and an architecture-specific rollout. This is an engineering assessment, not merge or Production authorization.

## Strict next actions

1. Commit and push this checkpoint as a handoff-only child commit. The green code head remains `c78c7ff39aac948110b2e9a243c67185db9305df`; the PR head will then be the later documentation-only commit visible in PR metadata.
2. Reverify all four remote PR heads, bases, draft state, mergeability, and checks after that push.
3. Reverify the dirty main checkout is byte-for-byte untouched and the #768 worktree is clean.
4. Stop before merging, deploying, or running any Production database change. Those actions require separate explicit authorization.

If later authorized, preserve the release sequence and allow only one pending migration at a time:

1. Merge/release #765 preparation, then deploy its compatible application.
2. Merge/release #766 activation.
3. Merge/release #767 preparation, then deploy its compatible application.
4. Merge/release #768 activation.

Do not merge all four first. Each database release must complete and be inspected before the next migration enters `main`.

## Work after Listing and Commission

Apply the necessity/value filter before building more machinery.

- `AdminAuditLog`: rebuild on the accepted post-Commission base; address deletion lock order, late-redaction PII, Listing and Commission writers, deleted-staff Case refund recovery, deleted-author moderation, two-account collisions, same-path mutation, and crash/retry behavior.
- Analytics: batch `ListingViewDaily` and `SellerProfileViewDaily` as private, policyless, zero-direct tables only if the operational value justifies it; prove indexes and retention progress.
- `SellerExactMapConsentEvent`: prefer least-privilege zero-direct access; legal/retention decision first.
- `CronRun`: defer full RLS; a dedicated cron role is the more useful control.
- Blog: use a lightweight hybrid batch, and fix inline image reference tracking before enabling upload cleanup.
- Reviews: use one cohesive `Review` plus `ReviewPhoto` hybrid batch with public aggregates and bounded private writes.

UI and other audit work remain independent. Do not absorb unrelated UI branches or the dirty main checkout into this RLS chain.

## Safe-to-switch criterion

It is safe to switch to a fresh Codex/VS Code chat only after:

- PR #768 exact-head CI is fully green;
- its intended base is restored;
- this checkpoint is committed and pushed;
- all four remote PR heads and checks are reverified; and
- the dirty main checkout is reverified untouched.

The new chat will not inherit this conversation automatically. Because the dirty main checkout's local copy is stale, its first instruction should be:

> Preserve the dirty main checkout. Read the authoritative pushed checkpoint completely with `git show github/codex/commission-domain-activation-20261119:recovery-checkpoints/rls-fast-track-20261121/CURRENT-RLS-FAST-TRACK-STATE.md` (fetch that branch first if needed); do not rely on the stale untracked local copy under `/Users/drewyoung/grainline`. Verify the four PR heads and current CI state, then resume at Strict next actions step 1. Do not merge, deploy, or run a Production migration without separate explicit authorization.
