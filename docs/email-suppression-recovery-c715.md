# C-715 email suppression recovery

## Scope and status

This package verifies and corrects the recipient-suppression half of Claude
finding **C-715** before the email tables enter RLS preparation. It is based on
main `cdcb7673e59855bf07232e3c212b30bd5db47ef7` and remains a local candidate
until the earlier C-875 migration is successfully released. SupportRequest
ENABLE is already live.

It does not enable RLS, change table grants, contact Resend, deploy the app or
run Production SQL.

## Verified finding

The predecessor Resend webhook handler treated every signed `email.failed`
event as a recipient-level transient failure. Five such events inside 30 days
created a durable `BOUNCE` suppression with
`source = 'resend_transient_failure'`, blocking transactional as well as
optional email.

That classification was invalid. Resend uses `email.failed` for send failures
that can include provider configuration, API-key, quota, message and recipient
problems. Temporary delivery is represented by `email.delivery_delayed` or a
`Transient` bounce, while a `Permanent` bounce is durable recipient evidence.

The candidate:

- classifies signed events in `resendRecipientAction()`;
- suppresses only permanent bounce, complaint and provider-suppressed events;
- treats transient and undetermined bounces as observability events instead of
  durable address evidence;
- records provider-suppressed delivery as a delivery block rather than falsely
  labeling it as a recipient spam complaint, and preserves that origin in the
  row's `resend_provider_suppressed` source;
- preserves an existing direct complaint or permanent-bounce event when a
  later generic `email.suppressed` event arrives for the same address;
- records `email.failed` through privacy-safe observability without suppressing
  a recipient;
- excludes every predecessor `resend_transient_failure` row from suppression
  lookups immediately after the corrected app is deployed; and
- adds migration
  `20261023040000_repair_resend_failed_event_suppressions`, which removes only
  those invalid BOUNCE rows and the obsolete `EmailFailureCount` rows.

The route was the only writer of `EmailFailureCount`. The table remains for one
compatibility window because account export, account deletion and rollback to
the predecessor application still reference it. The repair empties it; a later
no-consumer migration can remove the model, export field, deletion call, grant
and table together. Dropping it in this recovery would break those paths.
Real provider BOUNCE and COMPLAINT suppressions, manual suppressions and
account-deletion suppressions are retained.

## Refuted half of C-715

The claim that failed Resend webhook receipts should be cleaned up because they
keep ops-health red is not accepted. Unprocessed receipts are retry evidence.
They remain actionable until the provider replays them or the existing handler
successfully reclaims them. Removing them would hide unfinished work and break
the current replay contract.

## Evidence

- Failing-first behavior tests reject durable suppression for transient or
  undetermined bounces, reject complaint classification for
  `email.suppressed`, preserve direct complaint/bounce provenance in both event
  orderings, exercise partial-recipient failure plus replay, and require an
  atomic locked repair migration.
- A PostgreSQL 16 full-chain run seeded the predecessor damage before the
  candidate migration and failed without the repair. The proof deliberately
  committed the exact recovery SQL while no Prisma ledger row existed, checked
  the corrected storage state, then replayed the idempotent SQL and converged
  to exactly one completed ledger row.
- The completed full-chain run applied all 427 migrations and proved that the
  invalid suppression and counters were removed while a real hard bounce and a
  real complaint remained. A second PostgreSQL connection held the same
  `EmailFailureCount`-then-`EmailSuppression` lock order used by account
  deletion while the migration ran; the migration waited, completed without a
  deadlock, and the account-deletion transaction committed.
- The same disposable PostgreSQL run exercised direct COMPLAINT and permanent
  BOUNCE evidence before and after generic provider suppression. Generic
  suppression could not weaken existing direct evidence, while later direct
  evidence correctly replaced the generic row in storage.
- The focused behavior and observability suite passes 47 tests.
- The signed-handler seam still has helper-level multi-recipient failure and
  replay coverage. A route-level signed-event injection would require a broader
  handler dependency redesign, so it remains outside this bounded correction.
- The protected Production workflow requires exact main, exact successful push
  workflows, the exact candidate checksum, and an exact live deployment of the
  corrected app before owner access. Its read-only preflight records aggregate
  counts only, requires this migration to be the sole pending migration, and
  reads back zero invalid suppressions and counters after apply. The migration
  repeats the owner/source checks while holding table and advisory locks inside
  one explicit transaction, then performs its own postflight before commit.
  The workflow executes that transaction directly with `psql` and only records
  it in Prisma's ledger after commit. A failed transaction therefore leaves no
  failed Prisma migration row requiring an owner-level manual resolution; if
  ledger recording fails after commit, the idempotent transaction can replay
  before `migrate resolve --applied` is retried.

## Release order

1. SupportRequest ENABLE (`20261023020000`) is already live.
2. Release C-875 optional-email unsubscribe correction (`20261023030000`). Its
   first Production run `39975560599` failed during GitHub Actions setup before
   checkout, credentials, or SQL because its checkout pin was incomplete. Main
   `cdcb7673e59855bf07232e3c212b30bd5db47ef7` contains both the corrected pin
   and the exact-main Notification-proof trigger needed by its release binder;
   the migration remains pending until a later protected run succeeds.
3. Merge C-715 only after C-875 is live, allow its exact commit to deploy, and verify the deployment
   marker on both canonical aliases.
4. Run the protected C-715 workflow for
   `20261023040000_repair_resend_failed_event_suppressions`.
5. Continue the email-table RLS audit only after the readback passes.

Merging C-715 before C-875 is applied would make its candidate the newest
pending migration and block C-875's exact pending-set guard. Keep it local
until that release finishes.
