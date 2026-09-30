# Order live closeout — 2026-09-30

## Current state

Order is live and the zero-direct release is complete.

- Live application deployment: `dpl_G6hBoBC1jJt6KiphZifpqQj2Br4J`.
- Live application source: `02f27a3948a2cbc87ddb7b53d0f07e8251718b83`.
- All five canonical Production aliases point to that deployment.
- Recoverable predecessor: `dpl_9RH5JuxfotPEYYij4ZK4X8gNbNwW`.
- Core Order tables have accepted FORCE RLS.
- `OrderItem` and `OrderShippingRateQuote` have their accepted runtime locks.
- Post-FORCE correctness changes, blocked-pair checkout enforcement, and
  count-only operations health are live.
- Production migration `20260930033000_order_ops_health_summary` is applied and
  its protected postflight passed in run `36723979346`.
- Public main is `6ed0476659327961170fc186389a0d055da7f2be` after PR `#486`.
  That merge changes only historical proof workflows and tests, so it does not
  require another application deployment.
- The formerly failing merged-main historical proofs are green:
  Notification run `36735060463` and Conversation/Message run `36735060521`.

No Order migration, FORCE operation, deployment, smoke fixture, or alias move
should be repeated without a concrete source or Production-state change.

## Testing policy from this boundary

The repository's general CI job is monolithic and currently takes about 27–31
minutes because it replays hundreds of historical database release proofs. It
is useful as one integration gate but should not be launched repeatedly for
each small correction.

Use this release policy:

1. Run the smallest focused local contract or semantic proof that exercises the
   changed behavior.
2. Run formatting/YAML/type/lint checks only when the changed file type makes
   them relevant.
3. Require one full exact-head PR CI run before merging source.
4. Do not manually repeat that full run after it passes. The automatic
   merged-main run is a readback; inspect a concrete failure rather than
   restarting the whole suite preemptively.
5. Use protected exact-source Production workflows and bounded postflights for
   actual migrations or provider/deployment mutations. Do not substitute more
   general CI runs for those checks.

This keeps evidence proportional to risk while avoiding the repeated test-only
loops that slowed the release.

## Plan after Order

1. Automatic merged-main CI run `36735060328` completed successfully on exact
   main `6ed0476659327961170fc186389a0d055da7f2be`. It was readback only; no
   duplicate full-suite run is required.
2. Freeze the completed Order release boundary and preserve its predecessor
   until the stabilization window closes.
3. Reconcile the verified launch backlog against current main so already-fixed
   findings stay closed. Do not reopen #115, #120, #121, #122, #124, #134,
   #135, #143, or #149; their corrections are present on current main.
4. Advance one remaining high-impact launch item at a time. The highest known
   unresolved money-risk item is #108, dispute-loss allocation and seller
   recovery. It needs a concrete financial policy before any provider or
   Production mutation; source tracing and a bounded implementation proposal
   can proceed without changing live state.

## Remaining boundary

Order being live does not mean every Grainline launch finding is resolved.
Remaining audit items belong to separate money, Notification, commission,
credential, performance, and UI families. They must not be folded back into the
completed Order RLS release or used to repeat its accepted proofs.
