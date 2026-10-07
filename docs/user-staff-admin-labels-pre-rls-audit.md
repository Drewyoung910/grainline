# User staff admin-label projection pre-RLS audit

## Scope

This isolated successor removes the ten remaining display-only `User` relation
edges from six Admin-PIN-protected staff pages: audit, blog, broadcasts,
reports, reviews and support. The same package closes the final nine User
relation edges in guild verification and listing review. It is stacked on the
merged exact follower-authority head
`120a90ea98d4376577ffc85b8e7296adc34285b9` through merge commit
`ddbcd3abff78c5206171ba957a8d2423bdb23bf6` and does not authorize Production
SQL, deployment, credentials, grants, policies, ENABLE or FORCE.

Guild verification and listing review use the transactionally maintained
`SellerProfile.ownerAccountActive` snapshot both for preflight messaging and in
their mutation predicates. User lifecycle changes update that snapshot through
the existing database trigger, and both paths serialize on the seller row. The
isolated projection supplies only the original account creation timestamp needed
by Guild Member eligibility; a later lifecycle change still makes the mutation
predicate fail and rolls back the surrounding transaction.

## Product and privacy contract

`grainline_user_staff_admin_labels(text,text[])` accepts only the separately
authenticated `grainline_staff_read_runtime` session and independently checks
that the supplied local actor is an active `EMPLOYEE` or `ADMIN`. Application
routes retain Clerk authentication, rate limits and the session-bound Admin
PIN.

The operation accepts at most 200 syntactically valid local user ids, removes
duplicates while preserving first-request order, and returns only id, name,
email, deletion timestamp and creation timestamp. It cannot enumerate accounts,
select by email, or run through ordinary application runtime. Missing ids are
omitted. Callers retain existing deleted-account redaction behavior where
required.

The bound covers the exact page maxima: 30 audit rows, 80 blog rows, 25
broadcasts, 100 report participants, 50 reviews and 70 support rows.

## Source result

The exact scanner frontier changes from 19 relation edges in eight files to
zero relation edges, with zero direct delegates and zero raw User SQL. The six
display pages first load only durable foreign-key ids, then use the isolated
staff projection. Guild verification and listing review use the existing seller
lifecycle snapshot instead of joining User. The complete explicit source catalog
contains 53 functions: 34 ordinary-runtime and nineteen private. Nine private
functions belong to the isolated staff role and ten are seller, blog, review,
or commission snapshot triggers.

## Validation and decision

- TypeScript passes.
- Focused source, existing staff/admin regression, catalog and continuation
  tests pass.
- Disposable PostgreSQL proof covers active employee/admin access, ordering,
  deduplication, deleted labels, the 200-id bound, inactive staff rejection,
  ordinary-runtime denial and PUBLIC/untrusted denial.
- Exact scanner: direct 0; relations 0 across 0 files; raw SQL 0.
- `git diff --check` passes.

**GO for isolated source preparation. NO-GO for Production SQL, deployment,
grant changes or User RLS activation.** The service-ledger scope decision is
closed in `docs/user-service-ledger-separation-decision.md`; the two ledgers
remain separate tracked hardening groups whose state this release must not
change. Installed catalog comparison, guarded application of every confirmed
source-only authority migration, compatible-app promotion and smoke, and final
grant/policy design remain activation gates. The
bounded opaque-query review is closed in `docs/user-opaque-query-review.md`.
