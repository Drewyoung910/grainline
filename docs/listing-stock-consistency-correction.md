# Listing stock consistency — isolated correction, 2026-09-07

Scope: LISTING-F02/F03 from the locally preserved listing/inventory audit,
revalidated against `00c570b826dc421b6a349936ade97623cb5c65fe` on draft PR #432.
These are affected-Order stock-lifecycle blockers, not a new Listing RLS release.
No applied SQL, production workflow, grant, credential or provider setting changes.

## Reproduced failures and intended behavior

- F02: an old content-edit form containing quantity 10 restored current quantity
  8 to 10 while saving unrelated text. The RED regression evaluates the actual
  production Prisma update data object against a PostgreSQL-engine fixture;
  it failed `10 !== 8`. This is not a full authenticated server-action test.
- F03: the actual PATCH handler committed a +5 delta, then a lost response or
  a throwing post-commit Guild update caused a retry to apply +5 again. Both
  RED handler regressions failed `15 !== 10`.
- Deltas are intentional: desired 10 from baseline 5, with checkout already
  reducing current stock to 2, must produce 7. A blind absolute overwrite is
  not the fix. Independent explicit operations are ordered by database commit,
  not by when browser tabs were opened.

## Implementation and authority boundary

`InventoryQuantityControl` is shared by Inventory and Edit Listing. Existing
in-stock quantity uses an explicit **Save stock** button, independent of content
save; its input has no form field name. Creation/custom forms and conversion
from made-to-order retain their initial-quantity field. Existing sold-out content
can be edited without inventing replacement stock. Listing-type changes remain
atomic with content/photo/variant updates and carry their own bound receipt.

The application locks the owned Listing row, looks up a deterministic receipt,
then co-commits the stock adjustment and receipt in `SystemAuditLog` through the
same transaction. The receipt key hashes actor, listing and UUID; the immutable
request hash includes issue time and sorted scalar payload. Matching retries
return the stored result and original notification source IDs; differing payloads
or corrupted receipts fail closed. A receipt-write failure rolls back stock too.
Replayed type conversions cannot recreate inventory even after an intervening
conversion back to the original type. The locked type, ownership and editability
are checked again before writing. Content saves never write quantity when the
type is unchanged, and review/publication checks remain in place.

This is trusted application idempotency, **not** a new database authority against
a compromised runtime credential. Listing/SystemAuditLog permissions are unchanged.
The bounded user-workflow receipt uses the existing audit table and its primary
key; no new migration, table, role or general-purpose service is introduced.
Existing stock SQL, amount bounds, state transitions and notification authorities
are preserved. Post-commit failures can still return an error, but retry must not
repeat the stock delta. Saved responses describe that operation's committed result;
the subsequent page refresh obtains any more recent stock.

## Restart, retention and deployment rules

- Client session storage is scoped by Clerk actor and listing. Save exact intent
  before fetch; reload/changed live props must reuse it. Missing storage, corrupt
  state, timeouts, malformed/legacy responses and mismatched acknowledgements do
  not silently mint another attempt. Quantity editing is disabled while pending.
- New clients call versioned `/stock/adjustments`. An older deployment has no
  such route, so it cannot silently accept a request without recording a receipt.
  New `/stock` rejects old requests missing identity rather than keeping an
  unsafe compatibility fallback. Deployment requires old-page refresh behavior
  to be explained/tested; this is not a claim that old deployments are repaired.
- An absent receipt can apply only within 24 hours of its immutable issue time
  (maximum 60 seconds in the future), evaluated **after** acquiring the row lock.
  Existing matching receipts remain replayable after that window. An expired
  absent-receipt response includes exact operation identity and current stock,
  allowing the client to reset only after a definite no-effect response.
- No generic audit-receipt deletion job was found. Future audit retention must
  keep receipts through the entire acceptance window plus clock margin; never
  delete an in-window receipt. Retention/RLS work must inventory this dependency.
  Preserve the server freshness rejection if old receipts are ever removed.
- Session storage is not a durable backup across closing a tab, clearing browser
  data, or every crash. Server receipts survive those events, but losing the
  client identity requires checking current stock before an explicit new action.
  There is no automatic fresh-ID retry or claim of cross-device recovery.
- Persistent storage corruption or a mismatched receipt requires reconciliation;
  do not auto-clear it. A future support-facing receipt lookup/recovery UI and
  bounded receipt retention need a separate design, measurements and tests.

## Verification and limits

Focused suite: 34 passing tests, including actual-handler PGlite execution,
receipt rollback, lost response/post-commit failure, authentication/ownership,
locked-state changes, payload drift, expiry after locking, old-receipt recovery,
source reuse, draft publication protection and client restart acknowledgements.
TypeScript passed. The final full suite passed 4,414 tests with 13 skips and
zero failures (4,427 total), using the same `tests/*.test.mjs` inventory with
`--test-concurrency=2` to reduce local memory pressure. Full lint passed after
the harness rename, and the final auth-inventory/handler edits passed focused
lint and their 18-test rerun. `git diff --check` passed. The final local disk
guard reported 5.6 GiB free. Exact-head native CI remains the next gate.

The first full run found one auth-inventory contract failure: its source scan
did not follow the versioned route's authenticated PATCH re-export. The correction
checks exactly that two-statement delegation, rejects added verbs/target drift,
and executes the alias in the handler regressions. The public-route allowlist
is unchanged. A test-harness variable name also violated Next's lint rule and
was renamed; no application behavior was changed to satisfy either check.

`listing-stock-mutation-postgres-proof.mjs` is wired only into ordinary CI. It
accepts only loopback `ci` / `grainline_ci`, verifies PostgreSQL 16 identity,
creates one random isolated schema, and uses three connections. It runs the real
receipt helper and extracts the actual route's tagged stock UPDATE, then proves
five schedules: concurrent same-ID commit/replay, first-writer rollback, checkout
before/after adjustment, and independent adjustment IDs. Blocking must be observed
through `pg_blocking_pids`; the exact schema must be removed and its absence checked.
No public fixtures, role/grant changes or migrations are part of that proof.
This minimal native-lock fixture is **not** full-schema/runtime-login or provider
acceptance. Those, plus authenticated two-tab/reload/mobile UI, sold-out content
editing, both type conversions and unchanged create/custom forms, remain release
checks. Do not mark F02/F03 deployed or the overall audit closed from local tests.

Separate bypass/regression review covered alternate stock entry points, the
existing ownership/account/rate-limit boundary, old/new route overlap, receipt
atomicity, stale content writes, type-conversion replay and notification source
reuse. Findings tally for this package: two confirmed defects implemented as
unreleased candidates; zero false-positive closures; remaining audit, legal,
scale and Case obligations retain their prior linked dispositions.

Continue with the affected Case blockers after this exact candidate's full checks
pass, then follow `order-rls-completion-plan-20260907.md`. Do not start another
RLS domain or infer authorization for production from this implementation record.
