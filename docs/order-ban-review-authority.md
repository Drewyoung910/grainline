# Order seller-ban review authority

Status: locally implemented and PostgreSQL-proven; database-first candidate
only. No migration, deployment, RLS posture, grant or production state
changed.

## Product and authority audit

Banning a seller must immediately place every still-actionable paid Order under
staff review and later unbanning may remove only the exact marker introduced by
that ban. The predecessor kept the User, SellerProfile, commission and audit
changes transactional, but selected Order rows in application code and then
updated only against their earlier review fields.

That left three defects at the Order boundary:

- fulfillment or refund state could change after selection without preventing
  an obsolete Order from being flagged;
- appending the ban marker truncated the entire review note to 5,000
  characters, silently discarding newer staff-note capacity; and
- undo trusted Order identifiers parsed from audit JSON without proving that
  they still belonged to the banned seller.

The first fixed-operation candidate closed those three defects, but its two
runtime-callable consumers still accepted a caller-supplied ADMIN user ID.
Ordinary runtime could therefore name any active ADMIN and exercise the ban
review mutation without first passing the separately authenticated staff
database boundary. The application routes require Clerk staff auth and an
Admin PIN, but those controls did not make the database operation itself
source-validating. The disposable PostgreSQL proof reproduced that forged
actor path before this correction.

## Accepted design

A private policyless `OrderStaffCapability` table and three fixed
`SECURITY DEFINER` operations now own only the Order portion of the existing
ban transaction. The capability mint is executable only through a direct
`grainline_staff_read_runtime` session. It revalidates and locks the active
ADMIN actor and exact active non-admin target, binds the target, operation and
restore-payload hash, and creates a five-minute one-use UUID. Ordinary runtime
has no table authority and no `EXECUTE` on the mint.

The two ordinary-runtime consumers no longer accept an actor ID. They
atomically delete and return one exact, unexpired capability before deriving
the seller and mutating Orders. A rollback after consumption restores the
capability with the enclosing transaction; a committed call cannot replay it.
Restore snapshots are canonicalized identically on mint and consume, so a
caller cannot substitute another payload after staff authorization.

The flag operation locks eligible Orders in deterministic ID order and
rechecks the open fulfillment, no-refund and no-payment-block predicates. It
sets `reviewNeeded=true`, appends the fixed marker only when it fits the
10,000-character storage contract, never truncates an existing note, and
returns only the buyer ID plus a SHA-256/length restoration snapshot. Raw staff
notes never cross the fixed-function boundary.

The restore operation accepts at most 5,000 parsed snapshots, rejects malformed
or duplicate entries and proves every Order belongs to the target seller. It
removes a marker only when it is the exact suffix and the recovered prefix
matches both the stored UTF-8 hash and character length. A later staff edit, a
pre-existing marker, an overflow-preserved note or a foreign Order remains
untouched.

The application still co-commits these operations with the User,
SellerProfile, commission and AdminAuditLog changes in its existing
transaction. Splitting the Order mutation into a separately committed staff
transaction was rejected because it would make ban state and Order review
state diverge on either-side failure. The short-lived capability crosses the
credential boundary without crossing the transaction boundary.

Capability minting necessarily precedes the ordinary-runtime transaction. A
candidate integration pass found that this reordered the predecessor's missing
target check: a missing or already-deleted account could reach the SQL target
guard first and surface as an internal error instead of the established 404.
The application now performs a response-contract-only target preflight before
minting for ban and unban. It rejects missing/deleted users and ADMIN targets
with bounded policy errors. This check is not trusted for authority: the mint
and consumer still revalidate the target under database locks, so concurrent
deletion, role promotion or ban-state change fails closed.

The ban, manual unban and audited undo routes also repeat the signed Admin-PIN
check before minting. Runtime receives `EXECUTE` only on the two capability
consumers; the isolated staff role receives the mint. This slice grants no
table access and changes no existing production RLS posture.

## Validation rubric and evidence

- [x] Attacker input: an ordinary-runtime caller can choose the target and can
  attempt a forged actor, capability, operation or restore payload.
- [x] Root control: only the direct isolated staff database session can mint;
  the capability table is FORCE RLS with zero policies and zero direct grants.
- [x] Sink: both Order mutation consumers delete one exact bound capability
  inside the caller's existing transaction before locking or updating Orders.
- [x] Negative cases: forged, expired, replayed, cross-target and substituted-
  payload capabilities fail; accidental mint `EXECUTE` granted to ordinary
  runtime still fails the internal `SESSION_USER` fence.
- [x] Transaction case: rollback restores the consumed capability, while a
  committed successful call makes it non-replayable.

The focused static and disposable PostgreSQL tests exercise those cases. This
validates the candidate design; production acceptance still requires the
database-first release and actual separate-login postflight below.

## Scale and release order

The seller/status index already supports the eligible-order scan. Ban and
unban are rare staff operations and remain intentionally atomic; the 5,000-row
snapshot cap prevents an unbounded audit JSON restore. Reaching that cap should
be handled as an explicit support exception rather than silently partially
flagging a seller's Orders.

Release order is database-first: Extra-High SQL review, provision and prove the
separate staff login with exactly six functions (two reads, three mutations
and this capability mint), apply the byte-pinned compatible migration, run the
actual separate-login and ordinary pooled-runtime postflights, deploy the
compatible application, then eventually revoke Order table grants. Rollback
is application-first. The capability table remains policyless and private
through Order Phase A and FORCE.
