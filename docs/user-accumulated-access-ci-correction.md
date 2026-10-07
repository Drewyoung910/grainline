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

## Staff-script replay correction after the second CI failure

Approved correction `7219cd3d` was published to #525. Its three independent
checks passed, but CI `37538629478` stopped at the real staff-login convergence
proof: the current provisioning script requires fourteen functions while that
historical database has only the six accepted Order operations. The eight newer
User staff operations are intentionally held until their User predecessors pass.
The refusal at the required-operation catalog is correct; no merge was taken.

During historical replay, CI now preserves the current staff provisioning bytes
and uses the exact six-operation script from main predecessor
`66746f47e87a73a6efce2ee6833542be5a86cc57`, additionally pinned to Git blob
`46fd8e1bfa086cb097adf194eb193389122ee9d9`. The two newer fourteen-operation
source/catalog tests are verified before isolation and held with their User
family. The current script and all held tests/migrations are restored byte-for-byte
after the public seller-state predecessor. After the three new User preparations,
CI executes the current full staff convergence script against its local service,
then audits ordinary runtime grants.

The production provisioning script and all migration SQL remain unchanged.
The filesystem regression executes the real shell bodies using a local Git
object clone, proves the historical script has no new User operations, and
checks every original byte hash after restoration. A focused PostgreSQL fixture
executes both actual required-operation catalog queries: the newer script
refuses the six-operation prefix, while the historical script accepts it.

Six focused checks passed for staging, full staff source and catalog isolation;
the newly added prefix reproduction passed separately. Targeted lint,
diff checks and workflow YAML parsing pass. No full historical database replay
or application test batch was repeated locally. Public publication and
conditional merge require a new exact source-head decision because the
`7219cd3d` gate failed.

## Complete held-migration test dependency closure

Approved `64f24668` passed the formerly failing real staff-login convergence
stage and all three independent Order checks. CI `37560369695` then reached
the full test phase: 5,000 passed, four failed and nine skipped. Three failures
were ENOENT in account-deletion guards that read the intentionally held new User
migration. The fourth was a conversation/deletion serialization guard still
expecting the removed inline User lock. No source merge occurred.

All four affected guard files are now verified before isolation and held with
their migration. The serialization assertion follows the actual transaction's
effect-bound snapshot wrapper and the snapshot SQL's User FOR UPDATE, preserving
the requirement that this lock precede message redaction. It isolates that
function body so the finalizer's later lock cannot satisfy the assertion.

A TypeScript-syntax dependency census checks every root test module for literal
paths into the held migration families. Any omitted reader fails the short
initial package check instead of waiting for the long historical replay. This
is literal-path closure, not a claim to resolve arbitrary dynamic dependencies.

The five-file focused test batch passed 45/45. After strengthening the snapshot
body/order assertion, that one changed case passed again. Targeted ESLint and
diff checks pass. No application or migration SQL was changed, and no broad
local proof was rerun. The failed exact-head CI remains preserved evidence;
publication of this changed source head needs its own conditional decision.
