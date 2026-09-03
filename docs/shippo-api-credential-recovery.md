# Shippo test API credential recovery

Status: completed and accepted on 2026-09-03. The exposed Shippo test token is
deleted and rejects authentication; the replacement is proven across every
consumer, the corrected production application and both non-charging quote
paths. This document does not authorize another provider mutation, deployment
or RLS change by itself.

## Scope

The exposed `SHIPPO_API_KEY` is a test-mode token used by Grainline's shipping
quote, seller re-quote and test-label paths. Rotate only that test token. Do not
request, create, use or delete a Shippo live-mode token.

Shippo supports up to two simultaneously active test tokens. Use that overlap
to create one named replacement before moving consumers, then delete only the
exposed predecessor after the replacement deployment and non-charging provider
proof pass. Shippo displays a newly generated token only once, so the value
must move from the provider UI into a private mode-`0600` restart journal
without entering chat, terminal output, Git, CI logs or a sanitized artifact.

## Exact consumer topology

- Vercel team-shared environment variable:
  `env_374M3muVPW3jIKBS8X4Q7kqI`, key `SHIPPO_API_KEY`, encrypted, owned by
  `team_wvQeQHZGwCSwinC1uB7xbpjr`, linked only to project
  `prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp`, targets Development, Preview and
  Production;
- no project-local `SHIPPO_API_KEY` shadow exists;
- GitHub repository secret `SHIPPO_API_KEY` exists and is consumed by CI and
  provider-proof workflows; and
- ignored mode-`0600` `/Users/drewyoung/grainline/.env.local` contains the
  local operator/proof consumer.

The public Shippo account identity and non-secret shipping configuration are
not rotated solely because the token was exposed.

## Implemented operator candidate

`scripts/shippo-api-credential-exposure-recovery.mjs` implements the reviewed
sequence without pretending Shippo exposes token-management APIs:

- the first exact-main run is read-only against Shippo, Vercel and GitHub and
  writes a durable private journal before asking for dashboard token creation;
- the replacement is read once from the macOS clipboard, validated as
  test-mode, compared to the pinned predecessor digest, authenticated against
  the same hashed complete carrier-account inventory, fsynced into the private
  journal and immediately removed from the clipboard;
- Vercel shared row `env_374M3muVPW3jIKBS8X4Q7kqI` is updated in place, with
  no project-local shadow or invented previous variable; GitHub and the ignored
  local consumer then converge without putting the token in argv or output;
- exact CI-green application source
  `82f58889b12095d21449494a036a327cc9feb9b1` / CI `33702373864` is the only
  source eligible to deploy. It includes the separately merged
  `estimated_days` seller re-quote correction;
- the current database-credential epoch contains exactly eight predecessor
  deployments, beginning with database-replacement deployment
  `dpl_AmW64aR14Yk47HK54kwiMSiKwkJD` and ending with current shipping-secret
  final deployment `dpl_4La1GXphy21feYp4AdYgT7Q2Zs7f`. The operator rejects
  any ninth unreviewed predecessor, promotes one marker-bound candidate, waits
  35 minutes and removes those eight oldest-first with crash reconciliation;
- much older READY deployments are outside that bounded deletion set because
  they predate the accepted database password rotation and carry already-
  rejected database credentials. This is not a general deployment purge; and
- the operator stops again for dashboard deletion of the exact exposed token,
  then accepts only its 401/403 authentication rejection plus continued
  replacement identity and non-charging buyer/seller quote proof.

The operator never calls Shippo's Transaction endpoint and cannot purchase a
label. Its two test Shipments are the minimum provider witness for checkout and
seller re-quote semantics. Unit coverage exercises wrong mode, incomplete or
duplicate carrier inventories, consumer shadows, unknown deployment rows,
partial alias convergence, process stops around deployment creation/deletion,
out-of-order deletion, non-exact money and evidence redaction.

## Restart-safe sequence

1. Require the shipping-rate HMAC family to be completely accepted, including
   final deployment/alias convergence, original-secret rejection, sanitized
   evidence and removal of its private journal.
2. Re-inventory Shippo's visible test-token metadata in the provider dashboard.
   Refuse an unknown token or more than the expected predecessor/replacement
   set. Create one distinctly named replacement only if it is absent.
3. Capture the one-time replacement into a new private mode-`0600` journal.
   Require a `shippo_test_` prefix, a distinct digest from the predecessor and
   successful authentication by both tokens before changing a consumer.
4. Compare the normalized test carrier-account identity set reached by the two
   tokens without retaining owner email, raw provider identifiers or tokens in
   ordinary output/evidence. Refuse a different Shippo account.
5. Patch the exact shared Vercel row in place, update the exact GitHub secret
   and local current value, and prove their secret-free metadata/digests. Do
   not create a project-local shadow or a `SHIPPO_API_KEY_PREVIOUS` variable.
6. Deploy the exact reviewed application source with the replacement, bind and
   promote every canonical alias from the reviewed predecessor to the exact
   READY candidate, and verify health/source provenance.
7. Run the existing non-charging buyer quote proof with the replacement. It may
   create a test Shipment and rates only; it must not create a Transaction or
   purchase a label. Separately exercise the seller re-quote response after the
   `estimated_days` correction is deployed.
8. Drain and remove only the explicitly pinned older callable deployment set
   that embeds the predecessor token, preserving the current replacement
   deployment and canonical aliases.
9. Delete only the exposed predecessor test token in Shippo. Resume the same
   journal and require the predecessor to return authentication rejection while
   the replacement still passes the non-charging proof.
10. Write sanitized mode-`0600` evidence, remove the private journal only after
    acceptance and continue to the next exposed family.

## Fail-closed requirements

- Exact clean operator commit and successful CI are mandatory.
- Every provider, Vercel, GitHub, local, deployment and alias identity is
  byte/digest or metadata pinned before mutation.
- An ambiguous provider create/delete, deployment promotion or token probe is
  restart state, never permission to create/delete again.
- Old-token rejection alone is insufficient: the replacement must reach the
  same test Shippo account and return checkout-usable USD rates.
- Evidence contains only modes, counts, timestamps, digests and hashed
  provider identities. It contains no raw token, address, email, rate ID,
  shipment ID or carrier-account ID.

## Product boundary

The buyer quote path already passed a real Shippo test-mode proof using the
shared minimized request and correct provider `estimated_days` field. A
separate isolated correction fixes the seller label re-quote normalizer, which
read `est_days` and could omit transit estimates. That product correction must
pass and deploy separately; it is not hidden inside credential rotation.

Existing product limitations remain explicit: buyer rates are city/state/
postal/country estimates rather than exact street validation, multi-item
packing uses the documented one-parcel heuristic, and the platform outage
fallback can be economically imprecise for unusually large orders. None is a
reason to weaken token rotation or misstate provider proof.

## Accepted completion

- Operator/main:
  `a12a13ce4667f7274b7b8f00c70def5ceaefcde1`.
- Exact-main CI: `33707066095`.
- Corrected application source:
  `82f58889b12095d21449494a036a327cc9feb9b1` / CI `33702373864`.
- Replacement deployment: `dpl_6Qndfy4oiiGCkWdcZXYRDzsraqFz`.
- Accepted evidence:
  `shippo-api-credential-recovery-20260903.json`, SHA-256
  `ebcd62085d611bc09e6b4d4ee8e3f4dc38c9c1cf31cb6ba51e1dd68bff6e3f66`,
  mode `0600`.
- Provider proof: the exposed predecessor rejects, the replacement reaches the
  same normalized 11-carrier account identity, buyer and seller paths each
  returned three usable rates, and all three seller rates supplied
  `estimated_days`.
- Negative proof: no Shippo Transaction, label purchase, migration, RLS change
  or unrelated provider mutation occurred.
- Deployment proof: all four canonical aliases and health are correct after a
  3,972-second drain and bounded removal of the eight sealed predecessors.
- Secret lifecycle: the clipboard was cleared after private capture and the
  secret-bearing restart journal is absent after sanitized evidence finalized.
