# Order historical FORCE proof compatibility — 2026-09-30

## Accepted source correction

- Source base: exact `main` commit `02f27a3948a2cbc87ddb7b53d0f07e8251718b83`.
- Isolated source branch: `codex/historical-force-proof-compat-20260930`.
- Accepted source commit: `4c57d144582210e4405d8ca6a4871da40eaf8521` (`Fix historical RLS proof Order isolation`).
- Private recovery backup: `recovery-backup/recovery/order-historical-force-proof-compat-20260930`, read back at exact commit `4c57d144582210e4405d8ca6a4871da40eaf8521`.

## Failure being corrected

The exact-main push exposed two unrelated historical proof failures:

- Notification RLS FORCE workflow run `36718477586`.
- Conversation/Message FORCE workflow run `36718477585`.

Both workflows intentionally build historical disposable PostgreSQL states. Their existing Core Order isolation fence stopped at the September 26 Order release successors. The workflows therefore replayed newer Order migrations, reached `20260929160000_force_order_rls`, and lacked the current Order compatibility role/setup required by those unrelated migrations. PostgreSQL then reported the secondary `current transaction is aborted` state.

This was a historical proof-environment composition failure. It was not a live Order runtime, Production database, or canonical deployment failure.

## Correction

The two workflows now extend their existing checksum-pinned Order release-successor isolation and restoration lists through the current source frontier. Their focused contract tests pin the same names and digests.

| Migration | SHA-256 |
| --- | --- |
| `20260928010000_correct_order_deauthorized_case_access` | `a92fbcbc6c809e51a14cf53c7b98958693c327040565a64929c4527ff56b112f` |
| `20260928020000_correct_order_label_sender_contact` | `33a6d19fd0e50345bab11fa4c1a5a686aa72768d96db2a4cb9bce80ec7cd521b` |
| `20260928213000_remove_seller_buyer_email_projection` | `b9b0540de736daa01e8ac15f4fa41af3dd5ae8ffe4d5153aa2487a972b7b6c66` |
| `20260928220000_retire_seller_buyer_email_projection_predecessors` | `3a1f173fac0293ec05c43b44e9cd2a6895dcdd47effce55236e7e7c7a55fb799` |
| `20260929130000_revoke_order_item_shipping_quote_runtime_access` | `32c085b262400201864e6bfb7d32829b886b99a48771f62da141352c1c8bab99` |
| `20260929160000_force_order_rls` | `1f48553466fd1ee0373d48036e5e193cedbb6d4ff094ad1fba753e8c75e7e139` |
| `20260930030000_bound_listing_fulfillment_days` | `ceef219897013aa84bec0155f23e0ce01d8c48472d6e8bcb166e713d1e4edd96` |
| `20260930031000_mark_paid_private_listing_sold` | `0a1cb4828cce4d05abf783b12d790c13581fb7698f8063aaeaf92b5fa8c6bee1` |
| `20260930032000_block_checkout_user_pairs` | `dc1cdbf14a5b126635af44fbbc4ca820ac16e46823a68071400fd5786110209d` |
| `20260930033000_order_ops_health_summary` | `ed5e069248281ef8738f97bd0480ee77b85044a4ad2c9ac433ef2840a2a7e941` |

Core Order ENABLE migration `20260927090000_enable_order_rls` remains controlled by the workflows' separate dedicated isolation fence.

## Files changed

- `.github/workflows/notification-rls-ephemeral-proof.yml`
- `.github/workflows/conversation-message-force-proof.yml`
- `tests/notification-rls-ephemeral-proof.test.mjs`
- `tests/conversation-message-force-release.test.mjs`

Final source diff: four files, 122 insertions, two deletions.

## Verification

- `git diff --check`: passed before commit.
- Focused Node tests: 9/9 passed.
- Ruby YAML safe parsing: both workflow files passed.
- Local SHA-256 readback: every new pinned digest matched its migration SQL file.
- Private backup readback: exact commit `4c57d144582210e4405d8ca6a4871da40eaf8521`.

## Boundary

This source correction does not deploy an application, apply SQL, move aliases, change credentials, create fixtures, or change any live RLS posture. It keeps the historical Notification and Conversation/Message proof scopes stable by excluding unrelated current Order release successors from their historical database composition.

The live Order deployment remains `dpl_G6hBoBC1jJt6KiphZifpqQj2Br4J`, exact source `02f27a3948a2cbc87ddb7b53d0f07e8251718b83`, on all five canonical Production aliases. Its recoverable predecessor remains `dpl_9RH5JuxfotPEYYij4ZK4X8gNbNwW`.
