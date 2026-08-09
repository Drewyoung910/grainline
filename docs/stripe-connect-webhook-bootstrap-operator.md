# Stripe Connect disabled-bootstrap operator

Status: prepared and tested; never executed as part of this change.

This operator implements only provider step 4 from
`docs/stripe-webhook-provider-topology-audit.md`. It creates the separately
signed classic Connect `payout.failed` endpoint at the deliberately absent
bootstrap URL, disables and re-reads it, and only then installs the one-time
signing secret as the Sensitive production-only Vercel variable
`STRIPE_CONNECT_WEBHOOK_SECRET`.

It does not deploy the application, move or enable the Stripe endpoint, change
the platform or v2 event sets, run a migration, change a database grant, or
activate `StripeWebhookEvent` RLS.

## Why this is a single process

Stripe returns a classic endpoint's signing secret only in the create response.
The secret cannot be recovered later. The process must therefore retain the
secret in memory while it:

1. creates the endpoint at the absent
   `/api/stripe/webhook/connect-bootstrap-disabled` URL with `connect=true` and
   only `payout.failed`;
2. immediately disables the endpoint and retrieves it again;
3. requires the exact disabled URL, event set and live-mode state;
4. sends the secret to the pinned Vercel CLI through stdin, never an argument;
5. requires exactly one unbranched Sensitive production variable; and
6. writes only sanitized, mode-`0600` evidence.

The retained creation-request evidence can attest that `connect=true` was sent.
Stripe's endpoint response does not expose that source-scope field, so the later
Dashboard review and signed connected-account delivery remain required.

## Fail-closed boundaries

The operator refuses to start unless all of these hold:

- its explicit `preflight` or `bootstrap` confirmation matches;
- the current Git SHA matches a supplied lowercase full commit;
- the supplied GitHub Actions run is a successful `push` run of `CI` for that
  exact commit;
- the linked Vercel project is the reviewed `grainline` project;
- `STRIPE_CONNECT_WEBHOOK_SECRET` is absent from the unbranched Production
  environment;
- no Stripe endpoint already occupies the bootstrap or canonical URL;
- the key prefix matches the explicitly supplied provider mode; and
- the API key prefix, explicit provider mode and mode-specific bootstrap
  confirmation all agree (`sk_test_`/`test` or `sk_live_`/`live`).

The Vercel CLI is byte-version selected as `vercel@58.9.0`. It receives the
one-time signing secret only on stdin and uses `--sensitive`; `--value` is
forbidden by contract coverage.

The exact CI proof is read from the narrow GitHub Actions run endpoint. Public
repository reads need no CLI login; an optional `GITHUB_TOKEN` may be supplied
for API-rate-limit headroom and is never written or printed. The operator does
not depend on the workstation's mutable `gh` authentication state.

If endpoint disabling, retrieval, Vercel installation, Vercel classification or
evidence finalization fails, the operator re-reads the Vercel environment,
removes a possibly installed variable, deletes only the exact created endpoint,
and removes its pending evidence reservation. An ambiguous Stripe create error
is reconciled only when exactly one endpoint matches the absent URL, provider mode
and single reviewed event. Multiple candidates are never guessed at. Any
incomplete rollback is reported without printing a Stripe key or webhook
secret.

## Reviewed invocation shape

Run the read-only provider preflight first. Values shown here are placeholders;
never put a secret literal in a command or commit it to a file.

```sh
STRIPE_CONNECT_BOOTSTRAP_MODE=preflight \
STRIPE_CONNECT_BOOTSTRAP_CONFIRM=inspect-disabled-connect-bootstrap \
STRIPE_CONNECT_BOOTSTRAP_EXPECTED_COMMIT=<exact-main-sha> \
STRIPE_CONNECT_BOOTSTRAP_CI_RUN_ID=<successful-exact-main-ci-run> \
STRIPE_CONNECT_BOOTSTRAP_PROVIDER_MODE=<test-or-live> \
STRIPE_CONNECT_BOOTSTRAP_VERCEL_PROJECT_DIRECTORY=/Users/drewyoung/grainline \
npm run ops:stripe-connect-bootstrap
```

The separately authorized mutation uses the same exact commit, CI run, provider
mode and linked directory plus:

```sh
STRIPE_CONNECT_BOOTSTRAP_MODE=bootstrap
STRIPE_CONNECT_BOOTSTRAP_CONFIRM=create-disabled-connect-bootstrap-<test-or-live>
STRIPE_CONNECT_BOOTSTRAP_EVIDENCE_PATH=archive/stripe-connect-disabled-bootstrap-<date>.json
```

`STRIPE_SECRET_KEY` must enter the process from the existing protected local
environment; it must not be pasted into the command line, output, evidence, PR,
issue or chat. The final authorization must bind the exact main commit and CI
run. Preparation of this operator is not authorization to execute it.

The provider mode is part of the confirmation and idempotency identity. A test
key requires `create-disabled-connect-bootstrap-test`; a live key requires
`create-disabled-connect-bootstrap-live`. Neither confirmation can authorize
the other mode. Grainline's current pre-launch provider topology is test mode,
and exact-main read-only preflight `31325868408` passed on 2026-08-09 for merge
`b2a8d4c26c6739e19820f60b759e425dce1d97ce`: the production Vercel variable is
absent and neither reviewed Connect URL exists in Stripe test mode. That
preflight changed no provider or production state.

The later switch to live money is a separate release. It must create and prove
the live-mode endpoint, replace the production signing secret in the same
boundary as the live Stripe credentials, deploy the compatible configuration,
and retire or disable obsolete test-mode delivery as explicitly planned. A
successful test-mode bootstrap is not evidence of live-mode readiness.

## Test-mode production bootstrap record

PR #172 merged the provider-mode correction as exact `main`
`eda20f6f18d08d194b0a44a7414510e3c3a9ef58`. Exact-main CI run
`31328107308` passed. The operator's read-only preflight then passed against
that exact commit and run before the separately authorized mutation executed.

The guarded test-mode bootstrap passed on 2026-08-09. It created only the
reviewed classic Connect endpoint at the absent bootstrap URL with
`connect=true` and `payout.failed`, disabled and retrieved it before installing
the signing secret, and proved `livemode=false`. Vercel now contains exactly
one unbranched Production `STRIPE_CONNECT_WEBHOOK_SECRET` classified as
Sensitive. The retained evidence is
`archive/stripe-connect-disabled-bootstrap-test-20260809-eda20f6f.json`; it is
secret-free and was written locally with mode `0600`. No application was
deployed, the endpoint remains disabled, and no migration, RLS policy, grant or
live-mode Stripe state changed.

## Success evidence and next boundary

Success evidence contains the exact commit and CI run, provider mode, public
URL, disabled state, exact event set, a SHA-256 digest of the endpoint ID, the
creation-request source-scope attestation, and the Vercel variable name,
environment and Sensitive classification. It contains neither the endpoint
signing secret nor the Stripe API key.

After success, stop. The next separate boundary is deploying the compatible
application while the endpoint stays disabled. Updating it to the canonical
URL, enabling it, correcting other endpoint event sets and sending signed
deliveries are later provider operations.
