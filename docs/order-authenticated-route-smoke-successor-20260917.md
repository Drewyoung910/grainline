# Order authenticated route smoke successor — September 17

The historical operator pins application b22fa138 / CI 33595797533 / deployment
`dpl_6vA4bWrP4KhADtGAXKsisXdmvJBX`. Its default is intentionally retained.
The accepted September 15 Clerk application is f2bf570b / CI 34926985573 /
`dpl_316SCJK2AtaGPsSVQ5rTK42qC8oD`. The historical default rejects that deployment.
Changing only a wrapper binding would also leave the page marker and initial
restart journal attached to the old application. This successor closes that gap.

## Implementation

The shared operator now carries its explicitly selected release through source
admission, deployment metadata and aliases, the canonical page marker, initial
journal creation, restart validation and final sanitized evidence. Both the
operator's exact-main CI and the application's exact-main CI are checked before
credential loading. The default historical binding and entrypoint are unchanged.

The new `ops:order-authenticated-route-smoke-successor` entrypoint selects only
the fixed September 15 accepted application. It cannot migrate a v1 journal or
adopt a journal containing historical cleanup provenance. Fresh successor
journals retain their own exact operator/application/CI/deployment identities;
normal cleanup-only recovery remains available for matching successor journals.
The existing shared journal path prevents ignoring a retained historical run.
Neither operator may silently rebind or discard a conflicting journal.

## Evidence and execution boundary

Local focused validation passed 44 tests, including disposable PGlite fixture
seeding and UTC restoration. Tests cover selected-release journal round trips,
identity drift, distinct CI failures and ordering, all required aliases, wrong
canonical markers, failed health and historical-journal rejection. No live
provider request or production smoke ran as part of these tests.

This is isolated source preparation. It is not incident closure, final-main CI,
a production smoke acceptance or Order RLS activation. The integrated Order
candidate remains at 8258d653 and its production migration workflow is disabled.
Before execution: close the credential incident; review the exact eligible app
and fixture scope; integrate the operator and obtain matching final-main CI;
and obtain the existing required bounded production-smoke authorization.
If credential recovery deploys another app, review and update the successor's
fixed release binding first. Never treat the September 15 acceptance as proof
that these aliases still serve that deployment at execution time.

Use the same exact operator commit, CI, confirmation, private evidence and
cleanup-only settings documented in order-authenticated-route-smoke-plan-20260902.md,
with the successor package entrypoint only after the release gates are accepted.
The corrected distinct Shippo addresses, quantity-two checkout, UTC timestamp
restoration, bounded fixtures and cleanup requirements remain in force.
