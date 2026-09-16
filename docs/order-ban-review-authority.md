# Order seller-ban review authority

Status: locally implemented and PostgreSQL-proven; database-first draft only.
No migration, deployment, RLS posture, grant or production state changed.

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

## Accepted design

Two fixed `SECURITY DEFINER` operations now own only the Order portion of the
existing ban transaction. Both revalidate and lock the active ADMIN actor and
the exact currently banned non-admin target, then derive the SellerProfile in
PostgreSQL.

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
transaction. Runtime receives only function `EXECUTE`; this slice grants no
table access and changes no RLS posture.

## Scale and release order

The seller/status index already supports the eligible-order scan. Ban and
unban are rare staff operations and remain intentionally atomic; the 5,000-row
snapshot cap prevents an unbounded audit JSON restore. Reaching that cap should
be handled as an explicit support exception rather than silently partially
flagging a seller's Orders.

Release order is database-first: Extra-High SQL review, byte-pinned compatible
migration, disposable PostgreSQL proof, compatible application deployment,
then eventual Order table-grant revocation. Rollback is application-first.
