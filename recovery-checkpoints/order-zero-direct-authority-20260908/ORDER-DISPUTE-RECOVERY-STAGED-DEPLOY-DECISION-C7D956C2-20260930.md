# Order dispute recovery staged deployment decision — 2026-09-30

## Purpose

Create one immutable Production-target Vercel candidate from the exact accepted
main commit that contains the dispute-recovery application code. This decision
does not promote the candidate or move a canonical alias.

## Exact release binding

- Public main: `c7d956c2046b481693a7edec89f6b7b5995366cc`.
- Successful merged-main CI: `36799285933` (`push`, exact head above).
- Accepted Production migration:
  `20260930040000_prepare_order_dispute_recovery`.
- Accepted migration run: `36802255461`, exact main and CI above.
- Vercel project: `grainline` / `prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp`.
- Vercel team: `drew-youngs-projects` /
  `team_wvQeQHZGwCSwinC1uB7xbpjr`.
- Clean detached deployment worktree:
  `/private/tmp/grainline-order-dispute-recovery-candidate-20261001`.
- Reserved unique marker: `order-staged-c7d956c2-20261001-01`.

The deployment worktree is clean at the exact main commit. Its ignored
`.vercel/project.json` contains only the reviewed project, team, and project
name identifiers. The latest 20 Production deployments contain no deployment
with the reserved marker and no deployment sourced from exact main.

## Preserved predecessor

Fresh read-only Vercel inspection found all five canonical aliases on one READY
Production predecessor:

- deployment: `dpl_G6hBoBC1jJt6KiphZifpqQj2Br4J`;
- immutable host: `grainline-i2hm5z9cb-drew-youngs-projects.vercel.app`;
- source: `02f27a3948a2cbc87ddb7b53d0f07e8251718b83` / `main`;
- marker: `order-staged-02f27a39-20260930-01`;
- project and team match the reviewed Grainline identities;
- target/state: Production / READY.

The five aliases are:

1. `thegrainline.com`
2. `grainline.vercel.app`
3. `www.thegrainline.com`
4. `grainline-drew-youngs-projects.vercel.app`
5. `grainline-git-main-drew-youngs-projects.vercel.app`

## Candidate command

After exact authorization, re-read remote main, CI, the five alias owners, the
predecessor, the clean worktree, and marker uniqueness. If they remain exact,
run this command once:

```sh
cd /private/tmp/grainline-order-dispute-recovery-candidate-20261001
npx --yes vercel@58.9.0 deploy . --prod --skip-domain --force --yes \
  --project grainline --scope drew-youngs-projects \
  --meta gitCommitSha=c7d956c2046b481693a7edec89f6b7b5995366cc \
  --meta gitCommitRef=main \
  --meta grainlineOrderStage=order-staged-c7d956c2-20261001-01 --no-color
```

Persist the returned immutable URL and deployment ID. Do not repeat the command
if output is lost or ambiguous; reconcile the marker through the deployment
inventory first.

## Acceptance and recovery

Accept candidate creation only if provider readback shows:

- one deployment for the reserved marker;
- READY Production target;
- exact source/ref, project, team, and marker;
- successful `/api/health` and immutable-page deployment-marker checks; and
- all five canonical aliases still on the preserved predecessor.

`--skip-domain` is expected to leave canonical routing unchanged. If any of the
five aliases moves during candidate creation, immediately reassign it to
`grainline-i2hm5z9cb-drew-youngs-projects.vercel.app` and then re-read all five
alias owners. Stop if the candidate build, identity, health, or alias recovery
cannot be accepted.

## Scope after candidate creation

This step does not:

- promote the candidate;
- move an intended canonical alias;
- run an authenticated fixture or create a Stripe dispute;
- apply another migration;
- change credentials, grants, or RLS posture; or
- invoke a live dispute recovery.

The candidate contains the signed-dispute recovery handler and retry cron, but
canonical Stripe webhook delivery remains on the predecessor until a separate
reviewed alias-cutover decision. Promotion must name the accepted candidate and
the preserved predecessor and must include automatic or interruption-triggered
restoration if validation fails.

## Proportional verification

Merged-main CI already performed the Production build on this exact source.
Candidate verification is limited to provider identity, health, deployment
marker, and alias-owner readback. Do not rerun the repository-wide suite.

## Candidate creation result

The user authorized this exact candidate creation. All admission checks were
repeated immediately before execution and remained exact. The command ran once
and returned READY:

- deployment: `dpl_28tcPC1h37j1chjuPUB3fPxUeEGp`;
- immutable host: `grainline-qweqclm4p-drew-youngs-projects.vercel.app`;
- source/ref: `c7d956c2046b481693a7edec89f6b7b5995366cc` / `main`;
- marker: `order-staged-c7d956c2-20261001-01`;
- project/team/target: the reviewed Grainline identities / Production;
- provider aliases: none.

The remote build passed runtime database separation, Prisma generation,
Next.js compilation, TypeScript, static generation, and deployment. Provider
inventory contains exactly one deployment for the reserved marker. Authenticated
Vercel transport returned `{"ok":true}` from `/api/health`, and the immutable
home page embedded `dpl=dpl_28tcPC1h37j1chjuPUB3fPxUeEGp`. All five canonical
aliases remained on READY predecessor
`dpl_G6hBoBC1jJt6KiphZifpqQj2Br4J`; no recovery mutation was necessary.

The first immutable-host request attempt stopped locally because `--no-color`
was forwarded to the beta curl subcommand. The corrected calls succeeded. This
was a command-shape issue and did not change the candidate or canonical routing.

## Prepared live-routing boundary

The next exact action is a separate promotion decision. The prepared operator:

1. rechecks remote main and both exact CI bindings;
2. verifies the exact candidate and predecessor identities;
3. verifies candidate staged health and predecessor canonical health;
4. requires all five aliases to begin on the predecessor;
5. promotes only `dpl_28tcPC1h37j1chjuPUB3fPxUeEGp` and explicitly assigns all
   five canonical aliases;
6. accepts only exact candidate identity, all five candidate alias owners, and
   canonical health with the candidate deployment marker; and
7. restores and verifies `dpl_G6hBoBC1jJt6KiphZifpqQj2Br4J` on any execution or
   postflight failure.

`promote-with-recovery.sh` also invokes the fixed predecessor recovery mode on
shell exit or HUP/INT/TERM interruption. The preflight completed accepted before
authorization was requested. The live-routing action has not run.

Promotion makes the new signed Stripe dispute handler and retry cron canonical.
For future qualifying signed dispute events, the reviewed code may reverse a
seller transfer and later restore it according to the accepted recovery ledger.
It does not create a dispute, replay a webhook, or mutate an existing dispute as
part of the cutover itself.
