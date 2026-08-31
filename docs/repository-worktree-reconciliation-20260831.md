# Repository and worktree reconciliation — 2026-08-31

## Scope

This is an operational repository cleanup only. It does not change application
code, database state, Vercel state, credentials or provider configuration. The
goal is to return the normal repository root to current `main` without losing
the historical branches, uncommitted audit material or sanitized rollout
evidence that accumulated across isolated worktrees.

## Initial inventory

- Exact accepted `main` before reconciliation:
  `0780317f51504da1a5786134ff40f546e0bca733`.
- Git registered **21** worktree records after creating this isolated
  reconciliation checkout: **12** live directories and **9** records whose
  temporary directories no longer exist.
- VS Code's earlier “106 worktrees” warning was stale UI state and was not used
  as cleanup authority.
- The normal root `/Users/drewyoung/grainline` was still on
  `codex/saved-search-rls-rollout-20260717` at
  `c237ba9a855e708fa5d31a1e6011095d718d6973`, 12 commits ahead of and 1,090
  commits behind accepted `origin/main`.
- `git cherry origin/main` classified 10 of those 12 commits as patch-
  equivalent. The two non-equivalent patch IDs remain retained on the exact
  pushed historical branch; they must not be cherry-picked wholesale over the
  later accepted SavedSearch production release.

## Preserved uncommitted material

Before switching or removing anything, all unique dirty-worktree material was
copied byte-for-byte to the private mode-`0700` directory
`/Users/drewyoung/grainline-rollout-evidence/repository-worktree-reconciliation-20260831`.
Every archived file is mode `0600`.

The archive intentionally remains outside Git because it includes raw,
unreviewed Claude audit imports and local agent/configuration snapshots. Per
the repository audit contract, raw imports are not merged into `main`; only
independently verified findings may enter the closed ledger or implementation.

Important retained hashes:

| Material | SHA-256 |
| --- | --- |
| Root `audit_open_findings.md` | `b76b1ddd4ecd54a3785313b388bd9caff49a6086d333072f7dcc3bb05f9615d9` |
| Root `audit_open_findings.md.bak` | `41240cc1333c388e1c9208ff917a4026a3e778e997db050f32d9efd41ceb7074` |
| Root `AGENTS.md` snapshot | `ab47e27c9261409062154b9bd239a8562ac12e08df2e4824674dddf0896cfbe6` |
| Security-header evidence | `4bf1f250c06b353c9d9604d51dfca2e96cc4e527456a9fa385be2719e7f6bf88` |
| Order/payment/shipping compatibility evidence | `a2348cd61fed8e3bf9f5ffc3cf1906c71cb4c45a0ec2325e90d117893c001809` |
| `sleepy-hypatia` audit snapshot | `6b6f450178bae12060c92238361c166f09db144b2e258c00c1263e4822a09e9b` |

The four `.claude` worktree `AGENTS.md` snapshots and their identical local
`.codex/config.toml` files are also retained individually in that archive with
their own hashes. Copy verification used `cmp`, and the final archive hashes
were calculated from the archived bytes rather than assumed from the sources.

## Branch and worktree dispositions

Historical branch tips with commits not contained in `main` are retained on
their exact remote branches, including:

- `origin/codex/saved-search-rls-rollout-20260717` at `c237ba9a...`;
- `origin/archive/unreviewed-cron-webhook-20260717` at `9ba74c8e...`;
- `origin/fix/wizard-step-4-duplicate-button` at `a309d324...`.

Removing a worktree directory does not delete those branches or merge their
contents. Existing clean worktrees may be removed only when their head is
already in `main` or the exact historical head is retained remotely. Dirty
worktrees may be removed only after the uncommitted bytes are in the verified
private archive above.

The nine absent temporary-directory records eligible for metadata pruning are:

- `/private/tmp/grainline-ope-blocked-proof-3431bb83`
- `/private/tmp/grainline-ope-deploy-28209865`
- `/private/tmp/grainline-ope-invariants`
- `/private/tmp/grainline-ope-reads`
- `/private/tmp/grainline-ope-recovery-main-42ebc794`
- `/private/tmp/grainline-ope-signed-proof-fix`
- `/private/tmp/grainline-ope-signed-proof-main`
- `/private/tmp/grainline-pr274-refresh`
- `/private/tmp/grainline-pr275-refresh`

## Removed live worktrees

The following ten obsolete live checkouts were removed after the containment
and archive checks above. Their local/remote branches were not deleted:

- `/private/tmp/grainline-ope-force-postflight`
- `/private/tmp/grainline-ope-force-recovered`
- `/Users/drewyoung/grainline-saved-search-phase-a`
- `/Users/drewyoung/grainline-saved-search-release0`
- `/Users/drewyoung/grainline-worktrees/order-payment-event-refund-finalization-20260823`
- `/Users/drewyoung/grainline/.claude/worktrees/codex-refund-side-effects-20260823`
- `/Users/drewyoung/grainline/.claude/worktrees/hardcore-payne-fbb89c`
- `/Users/drewyoung/grainline/.claude/worktrees/optimistic-rhodes-a46222`
- `/Users/drewyoung/grainline/.claude/worktrees/sad-mclean-08ccb8`
- `/Users/drewyoung/grainline/.claude/worktrees/sleepy-hypatia-4aa428`

The accepted OrderPaymentEvent FORCE postflight from the removed temporary
checkout remains independently retained at mode `0600` with SHA-256
`d63cea7bd6a95232790aef4ecd4b279ae837bada1bad7cb80ef6aa604671eea1`.

## Completed result

All completion requirements were reverified:

1. named stash `64554ce2e4ca7d591a422bb9c558f3d8b0c4a7cd` and the private archive preserve
   the former root's dirty state;
2. `/Users/drewyoung/grainline` is clean on exact `main`
   `0780317f51504da1a5786134ff40f546e0bca733`;
3. all ten removed live worktrees satisfy the containment/archive rule;
4. all nine missing-directory records were pruned from Git metadata;
5. Git now registers only the normal root and this isolated reconciliation
   worktree;
6. the volume had 16 GiB available after cleanup;
7. no production, provider, credential or database state changed.
