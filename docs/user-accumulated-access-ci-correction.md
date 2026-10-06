# Accumulated User access CI correction

## Exact failure and preserved release boundary

Approved source `0947d9ca` was published to draft PR #525 against main `66746f47`.
The three independent Order checks passed. CI run `37535571811` failed its
post-FORCE application-correction step because `staff-preview-pin-boundary`
still expected `prisma.user.findMany` in the thread page after that read had
moved to `userConversationParticipants`. The page still verifies the PIN before
the actor/conversation-bound participant projection and before message reads.
The correction updates that assertion and explicitly rejects direct User reads.

The conditional approval did not permit merging a failed head or publishing a
changed head. This successor is local preparation until its exact publication
is approved. No application, migration SQL, credentials or Production state
change in this correction.

## Batched source-guard corrections

One batch of 95 affected non-database guard files ran 742 checks: 736 passed and
six historical source assertions failed. The six failures were verified against
the actual fixed operations and corrected together:

- Deleted-account reporter labels now come from the isolated staff projection;
  the display and search still suppress deleted-account email.
- User directory ordering moved into fixed SQL. The page must call the actor-bound
  directory page operation; the family proof pins createdAt DESC, id DESC.
- Custom-listing buyer labels come from the authorized conversation operation;
  the wrapper must validate deletedAt and retain the neutral label helper.
- Onboarding rate limits precede Clerk-owner lookup and owned unique seller lookup.
- Onboarding ownership is local User id resolved by Clerk, with banned/deleted denial.
- Account-deletion Stripe diagnostics come from the effect-bound preflight result;
  identity equality, result validation and clearing during anonymization remain.

Two other admin PIN/email guards still referenced direct User count/email reads;
they now pin the isolated fixed operations and the same before-query PIN boundary.
The focused recheck ran 65 tests, initially 64 passed with one incorrect new
matcher; that matcher was corrected against the actual top-reporter call site.
The failed file then passed all eleven cases. Do not claim a second full 742-test
batch was run or discard the initial failure evidence.

## Historical replay integration

CI previously isolated all accepted earlier User migration families during
historical Order replay, but lacked isolation for the three new families. It now:

1. Verifies the accumulated User source package while its exact files are present.
2. Holds the staff/ban, account-deletion and relationship migration directories,
   plus their migration-dependent tests, outside the historical replay tree.
3. Restores the same bytes only after the public seller-state predecessor passes.
4. Applies exactly those three additive preparations to the disposable CI PostgreSQL
   service and runs the canonical runtime-grant audit before the build.

The staging regression test executes the actual isolate/restore shell bodies
against a copied disposable filesystem, confirms historical inventory excludes
all eighteen new function names, and verifies original migration/test hashes after
restoration. It makes no database connection and runs no SQL or provider effect.
The staging test itself is held during historical npm-test replay so it cannot
try to copy files already intentionally held elsewhere.

## Validation and next gate

The actual filesystem staging tests pass 2/2. The updated staff source/provision
check passes 1/1. Targeted lint and diff checks pass. Existing function behavior,
current-schema type checking and DCL convergence proofs from `0947d9ca` remain
applicable because this successor changes only source guards and CI integration.

Publish a new exact head only with approval, then run the four PR gates once.
Mark ready and merge only with all four green on that head and unchanged main.
Compatible source merge still does not install SQL in Production or activate User
RLS; the remaining relation, raw SQL, service-ledger and installed-catalog gates
remain as recorded in the indirect-access audit.
