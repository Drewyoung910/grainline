# C-715 email suppression recovery

## Scope and status

This package verifies and corrects the recipient-suppression half of Claude
finding **C-715** before the email tables enter RLS preparation. It is based on
main `0ec7c793b3e84497de88371c597ca3547e12d8ab` and remains a local candidate
until the earlier SupportRequest and C-875 migrations are released in order.

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
problems. Temporary delivery is represented by `email.delivery_delayed`, while
terminal rejection is represented by `email.bounced`.

The candidate:

- classifies signed events in `resendRecipientAction()`;
- suppresses only terminal bounce, complaint and provider-suppressed events;
- records `email.failed` through privacy-safe observability without suppressing
  a recipient;
- excludes every predecessor `resend_transient_failure` row from suppression
  lookups immediately after the corrected app is deployed; and
- adds migration
  `20261023040000_repair_resend_failed_event_suppressions`, which removes only
  those invalid BOUNCE rows and the obsolete `EmailFailureCount` rows.

The route was the only writer of `EmailFailureCount`. Real provider BOUNCE and
COMPLAINT suppressions, manual suppressions and account-deletion suppressions
are retained.

## Refuted half of C-715

The claim that failed Resend webhook receipts should be cleaned up because they
keep ops-health red is not accepted. Unprocessed receipts are retry evidence.
They remain actionable until the provider replays them or the existing handler
successfully reclaims them. Removing them would hide unfinished work and break
the current replay contract.

## Evidence

- A failing-first behavior test could not import the new classifier on the
  predecessor.
- A PostgreSQL 16 full-chain run seeded the predecessor damage before the
  candidate migration and failed without the repair.
- The completed full-chain run applied all 425 migrations and proved that the
  invalid suppression and counters were removed while a real hard bounce and a
  real complaint remained.
- The focused behavior and observability suite passes 37 tests.
- The protected Production workflow requires exact main, exact successful push
  workflows, the exact candidate checksum, and an exact live deployment of the
  corrected app before owner access. Its read-only preflight records aggregate
  counts only, requires this migration to be the sole pending migration, and
  reads back zero invalid suppressions and counters after apply.

## Release order

1. Release SupportRequest ENABLE (`20261023020000`).
2. Release C-875 optional-email unsubscribe correction (`20261023030000`).
3. Merge C-715, allow its exact commit to deploy, and verify the deployment
   marker on both canonical aliases.
4. Run the protected C-715 workflow for
   `20261023040000_repair_resend_failed_event_suppressions`.
5. Continue the email-table RLS audit only after the readback passes.

Merging C-715 before the two earlier migrations are applied would make its
candidate the newest pending migration and block their exact pending-set
guards. Keep it local until those releases finish.
