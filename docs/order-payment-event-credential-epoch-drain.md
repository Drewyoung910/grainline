# OrderPaymentEvent credential-epoch deployment drain

Status: isolated, tested and not executed. Production is unchanged.

## Why the boundary expanded

The transition-authority deployment is live and its bounded authenticated
smoke is accepted. The next documented step had been called an exact-ID
"predecessor drain," which implied one superseded deployment. A complete
read-only Vercel inventory on 2026-08-30 disproved that assumption.

The accepted database credential recovery proves the earlier runtime password
rejects. The conservative epoch begins at provider timestamp `1786644755419`,
when replacement deployment `dpl_C3N3PudFHg4GoRMAAZJuz9aNZ5Y6` was created,
not at the later recovery completion timestamp. That replacement was already
removed by the accepted CheckoutStockReservation drain. Vercel currently
retains 12 READY Production deployments created after that cutoff: the current
compatible deployment and 11 superseded READY Production deployments. Every
superseded artifact remains callable through its unique
Vercel URL and is conservatively classified as carrying the current pooled
`grainline_app_runtime` password. Deleting only the immediate predecessor
would therefore leave ten other current-credential applications callable.

This is not evidence of an RLS regression. `OrderPaymentEvent` RLS is still
off and predecessor table CRUD is intentionally retained. It is a rollout
inventory correction caught before grants or RLS posture changed.

## Exact reviewed credential epoch

Current deployment:

- `dpl_Coyjd6rTXteBV9e4QZtZGFDaiEYc`;
- source `ce7550dae6c417440230f4d596f2239393075f31`;
- URL `grainline-ees25wgos-drew-youngs-projects.vercel.app`;
- provider `createdAt=1788114206219`;
- READY, Production, maximum function timeout 300 seconds; and
- all four canonical aliases plus `/api/health` are accepted.

The exact superseded set, newest to oldest, is:

| Deployment | Source | Provider createdAt |
|---|---|---:|
| `dpl_UiZckAkuj8CSyLPBeQBUHF5Fq1Dj` | `4908bc7f377f5950da8de6b3398049d65a5fdfcb` | `1788087169342` |
| `dpl_7UeENeZebXL9yL481DWrXkDpWd4R` | `07eb9fc57bcec4d2fbac4d9ffc58b814ff78f5a8` | `1788072322091` |
| `dpl_2WkGbkiDdD8ySQYnCTur7ND3n2kd` | `4b2d4693ac03db773b766ca4c4c53c072ac0fdbe` | `1788056934561` |
| `dpl_HugNfsCT8TTPaFn21iSUJW7JcX37` | `4b2d4693ac03db773b766ca4c4c53c072ac0fdbe` | `1788056709026` |
| `dpl_BdqJHNwjCUcsJ1xQvmghsbW7C3W3` | `8548c1bac683547f54e34c91496f5b6d7ffd059a` | `1788050160433` |
| `dpl_CcwbUVcaEsiVU1yscDT5fxX72P8S` | `3431bb83fa16fabb9b9e18a729a7d138d48764d9` | `1787952965308` |
| `dpl_8FMq11zfZT166Dve7Vf6sTJTXFzX` | `a09827e0a641ec2f7e228520661cd7e74625bb0d` | `1787861512393` |
| `dpl_AJanN3zfnubB39Aj14NFziHAhfeB` | `5ef81acca6f8e302830b983a614432094cfa2458` | `1787716306173` |
| `dpl_JCmwmKQVwTnvMB2nk7XwYFvQR5xA` | `a6593516be9fd5531e867aea43b4bbf6319f3094` | `1787695466246` |
| `dpl_73aR913b9hfgkcdfBv2MwMyypR5a` | `2820986538c0d64f035defce052ba4ad0de1b3fb` | `1787622919541` |
| `dpl_7PRTnXtMrMNq83ZFPJNeqFtyXZ8h` | `e9239463a71860451191344b26dd20b45298f239` | `1786857420805` |

The 100-row inventory page continues below the credential cutoff, proving the
entire current credential epoch was visible. Every reviewed deployment was
also inspected by exact ID and reported READY Production state and a maximum
function timeout no greater than 300 seconds.

## Restart-safe operator

`scripts/order-payment-event-credential-epoch-drain.mjs` is deliberately a
deployment-only operator. It:

1. requires an exact clean `main` commit and successful same-commit CI;
2. byte-verifies the accepted mode-`0600` credential-recovery evidence at
   SHA-256
   `ed7f8952c1eb5d72aa9d661701c64cc0153eed48f59494e3fe136b2c80e8e943`;
3. inventories READY, BUILDING, QUEUED and INITIALIZING Production states and
   refuses any unknown, duplicated, reordered or paginated current-credential
   deployment;
4. inspects the current deployment and all 11 exact targets, checks the
   300-second request bound, all four canonical aliases and canonical health;
5. writes mode-`0600` restart state before deletion;
6. removes the 11 exact deployment IDs oldest-first, preserving the newest
   rollback candidate until last;
7. after every removal, proves exact-ID absence, refreshes the complete active
   inventory and atomically advances the restart journal; and
8. proves zero current-credential predecessors remain, re-verifies the current
   deployment, aliases and health, writes sanitized evidence and removes the
   private restart journal.

If a removal succeeds but the process stops before advancing the journal, the
next exact-main invocation may recognize only the next oldest missing prefix
and resume. A missing target out of order, new deployment, alias drift,
unhealthy canonical site, changed timeout, changed recovery evidence, dirty
Git tree or different CI binding fails closed.

The operator contains no database connection or SQL and cannot run migrations,
change grants/RLS, deploy, alter aliases, mutate credentials or change provider
configuration. Its only mutation is permanent removal of the 11 reviewed exact
Vercel deployment IDs. Execution remains a later production boundary.

## Following gates

The zero-direct-access gate remains separate and must prove the exact deployed
and operator trees contain no ordinary-runtime `OrderPaymentEvent` base-table
consumer. Accepted drain plus zero-direct-access evidence permits preparation
of the policyless `ENABLE` and direct-grant-revocation release. The separate
`FORCE` release still follows successful ENABLE migration and pooled-runtime
proof. `Order`, `OrderItem` and shipping-quote activation remain independent.
