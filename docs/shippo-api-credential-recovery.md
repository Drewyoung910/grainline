# Shippo test API credential recovery

Status: planned next credential family after the shipping-rate HMAC recovery
finishes. This plan does not authorize a provider mutation, deployment or RLS
change by itself.

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
