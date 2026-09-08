# Order correction release package — September 8, 2026

## Decision and boundary

Prepare the accepted correction composition for exact release packaging; do not
restart its code audit or infer production activation. The accepted source is
`99f6e8cb9057d0daad5a7968765de2dc2e770c8f`, full CI `34203109385` and
paid-repair `34203109383`, staff bootstrap `34203109421`, account-deletion
`34203109405`. That native proof accepted six drafts/nine bodies together and
restored catalog/data after rollback. Full CI had 4,454 passes, nine skips and
zero failures/cancellations, plus TypeScript, lint, dependency audit and build.
The exact acceptance is preserved on draft PR #432 and in the ignored mode-0600
`recovery-checkpoints/order-composition-proof-20260908/ACCEPTANCE.md`.

This successor is **source-only packaging and verification**. No migration file
is staged, no production workflow is added or dispatched, and no merge/readify,
deployment, credential/provider/grant change or worktree cleanup occurs.
The six existing draft bytes and every sealed historical verifier are unchanged.

## Fixed package and ordering

`scripts/order-correction-release-package.mjs` checks all 251 predecessor
migration files against the existing reviewed checksums, then additionally pins
the complete composed catalog with SHA-256
`61e62d787b12ab1438b299762b6d2655600e4cd2542fdaa846121eb86bac25d9`.
This comprises the historical tree through OrderPaymentEvent FORCE, the original
18-member Order compatibility family, the earlier Case correctness successor,
and the 17-member September 5 zero-direct compatible prefix. It is a required
predecessor for this correction package, **not a claim that production has
applied all those candidates**. The earlier prefix needs its own accepted
execution before this package can run.

Unknown/missing directories, symbolic links, changed migration bytes and changed
catalog membership fail. The independent draft manifest checks each correction's
existing fixed hash and generator parity; the release package never uses the
CI-adapted reservation payload as production SQL. Its source path points to the
unchanged owner-pinned draft on disk.

Proposed migration names, reserved in the package but outside Prisma migrations:

| Boundary | Proposed migration |
| --- | --- |
| Order 1/4 | `20260908090000_correct_order_label_outcome_inputs` |
| Order 2/4 | `20260908090100_correct_order_refund_reconciliation_inputs` |
| Order 3/4 | `20260908090200_correct_order_receipt_notification_type` |
| Order 4/4 | `20260908090300_correct_order_label_clawback_clock` |
| Case reader-first | `20260908091000_correct_case_lifecycle` |
| Separate reservation integrity | `20260908092000_correct_checkout_reservation_repair_outcome` |

The four Order members form one contiguous compatible prefix. Case and
reservation are separate one-member boundaries. A request explicitly names one
boundary, `before`/`restart`/`after`, and the exact completed-or-absent state of
the other two. It cannot accept an unrelated partially applied Order prefix as
a companion or silently include another group in its remaining migration list.
Returned lists are data, not execution instructions. All results explicitly
retain `productionExecutionAuthorized=false`.

Do not put all six candidates into a generic `prisma migrate deploy` path:
that would allow the Case or reservation boundary to ride along. The eventual
guarded runner must isolate exactly its selected migration set and reverify the
full ledger/source binding inside its serialized operation. Case result readers
must be deployed before Case SQL; label-clock SQL must precede automatic-retry
acceptance. A corrected migration with a finished ledger row is skipped, never
replayed through a draft's before-attestation. No unsafe historical repair body
is proposed as a routine production rollback.

## Restart and target-catalog checks

The ledger classifier accepts only the complete fixed predecessor and the exact
contiguous selected correction prefix. Unknown, missing, duplicate, incomplete,
gapped, rolled-back, malformed and checksum-drifted rows fail. The three narrowly
reviewed historical ledger exceptions are delegated to the unchanged existing
verifier: listing-variants zero-step rolled-back alias, DirectUpload's exact
zero-step failed-and-rolled-back attempt alongside its applied row, and the
fixed historical schema-numeric-guards checksum. Those exceptions do not admit
another failed attempt or arbitrary rollback anywhere else.

For all nine target functions, the ledger determines whether the exact before
or after SHA-256 body must be present. Both mismatch directions fail. A package
with two functions is all-or-nothing; it cannot be classified as half applied.
All named overloads are inventoried; only the exact schema-qualified typed
signature may match. Named arguments, return shape, defaults, variadic/strict
flags, language, volatility, parallel safety, definer/search path, owner and
effective runtime/explicit ACL disposition are checked. The notification core
remains runtime-private. The reader avoids rendering-dependent comparison of
argument types by matching the exact schema-qualified `regprocedure` identity.

This is a ledger/target-catalog component, **not the whole production scope
verifier**. It has no database connection or credential reader. Its client-based
target reader executes SELECT only but does not establish its caller's role,
transaction mode, database identity, global role graph, or all table/grant/RLS
state. The eventual protected reader must enforce repeatable-read read-only
inspection and exact owner/runtime identity, and combine those required checks
before declaring release readiness. No code path in this package is wired to
production, and no proof result claims actual pooled-runtime authentication.

## Verification and limitations

The local unit matrix covers all 20 Order restart combinations, separate Case
and reservation boundaries, strict historical exceptions, incomplete requests,
every target's body/ledger mismatch and identity/authority drift. The real SQL
reader is exercised against the shared offline Prisma-schema fixture with actual
function bodies, including PUBLIC execution, STRICT, overload and search-path
negative controls. This selected-function fixture is not a fully migrated server.

`scripts/order-correction-release-package-postgres-proof.mjs` is wired only into
ordinary CI after the accepted combined composition proof. Its named environment
variable permits only loopback `grainline_ci` under disposable `ci`, PostgreSQL
16 identity and the restricted disposable runtime posture. It reads the real CI
ledger, requires all 251 current checksums, then explicitly models the three
historical production representations **in memory only**. It likewise first
requires actual target owner `ci`, then models `neondb_owner` for assertions.
Those mappings are fixture setup, not production observation or role proof.

The native proof tests seven sequential states and twelve mismatch denials while
applying the exact already-reviewed CI payloads. It never writes the migration
ledger. The real catalog and data are restored after success/failure; no success
survives rollback verification failure. Result output is bounded and secret-free.
The separate combined behavior proof remains in place; this does not replace it.

An initial source-tree check failed because the legacy catalog uses locale
ordering for mixed eight-/fourteen-digit migration names, while directory
inventory used lexical ordering. Comparing both name inventories with the same
sort fixed that representation-only mismatch; the fixed catalog digest and all
historical bytes/validators remained unchanged. The first 11 focused tests then
passed, including real engine composition and restart checks. Final validation
and exact-head native CI must be recorded before accepting this new component.

## Remaining work — no activation inferred

1. Finish the predecessor-prefix and correction production scope/runner package:
   exact application/CI binding, selected migration isolation, role graph,
   relevant table/column/function grants and RLS, restart serialization and
   final scope proof. Do not update sealed historical verifiers just to admit
   this successor; compose a new exact boundary.
2. Close the umbrella credential incident from sanitized acceptance evidence.
   No credential inspection, rotation or provider change is authorized here.
3. Accept the compatible application and separately provisioned staff boundary
   in the documented Case-reader-first/label-DB-first order.
4. Run fresh final-source authenticated buyer/seller/staff, checkout and shipping
   quotes, labels/refunds/retries and provider/cleanup acceptance.
5. Review predecessor overlap/drain; then separately accept Order ENABLE and
   FORCE. OrderItem and OrderShippingRateQuote remain subsequent releases.

See `order-release-readiness-20260908.md` for the broader map. Existing legal,
financial, scalability and product findings remain tracked; this packaging pass
neither opens a new broad audit nor closes those findings by implication.
