# User relationship projection pre-RLS audit

## Scope and exact source

This stacked source package begins at local account-deletion commit
`80b4955b75ff575c73c8a9b2d29de298d23aa513`, which is itself stacked on the
preserved staff/ban commit and accepted main `66746f47e87a73a6efce2ee6833542be5a86cc57`.
It converts the final seven ordinary `prisma.user` reads across six files.

This is compatible source preparation only. It does not authorize or perform
Production SQL, deployment, credential changes, table grants, User policies,
ENABLE RLS, or FORCE RLS.

## Converted behavior

| Caller family | Prior reads | Prepared operation |
| --- | ---: | --- |
| Custom-order request | 1 | Active-buyer-bound seller User and SellerProfile eligibility projection |
| User report | 1 | Active-actor-bound target lifecycle projection |
| Conversation thread | 2 | Conversation-authorized participant identity/lifecycle projection, refreshed before sends |
| New conversation | 1 | Active-actor-bound target identity/lifecycle projection |
| Custom listing | 1 | Conversation-authorized buyer label projection |
| Seller settings | 1 | Active-owner notification preference projection |

The conversation operation admits only a participant or an active staff User
with an unresolved `MESSAGE_THREAD` report, matching the existing conversation
read boundary. The application still requires the admin PIN before the staff
caller reaches this operation. Message and custom-order writes retain their
existing lock-time participant, block, and account-state checks, so these
read projections do not become the final mutation authority.

## Prepared functions

- `grainline_user_relationship_target_state(text, text)`
- `grainline_user_conversation_participants(text, text)`
- `grainline_user_custom_order_seller_state(text, text)`
- `grainline_user_owner_notification_preferences(text)`

All four functions are `SECURITY DEFINER`, schema-qualified, revoke `PUBLIC`,
grant shared runtime only `EXECUTE`, and are retained by canonical runtime-role
provisioning. The migration does not alter User table grants or RLS state.

## Validation and exact frontier

- The direct-call scanner is now exactly zero calls across zero files, with an
  empty method map and no ordinary direct User writes.
- Disposable PGlite proof passes 3/3 cases covering participant authorization, unauthorized
  conversation rejection, reported-staff access, active-buyer custom-order
  projection, owner preference isolation, and exact role-provisioning names.
- The focused surrounding application suite passes 64/64 tests after updating
  historical scanner expectations to the exact zero-direct frontier.
- Targeted lint and diff validation pass; the package diff contains no
  credential patterns.

Zero direct calls is a meaningful milestone, but it is not User RLS readiness.
A preliminary accumulated-source scan still flags nested User relation
projections in 22 files and 10 raw User SQL statements across nine files.
Those inventories must be classified and converted or proven compatible before
any User table grant or RLS decision. Installed-function and service-ledger
inventories also remain open.

## Decision

**GO for isolated compatible source preparation. NO-GO for Production SQL,
deployment, User grants, policies, ENABLE, or FORCE RLS.**

Next, replace the preliminary relation/raw searches with durable exact
inventories, classify public projections versus private lifecycle/identity
reads, close the private paths, and then inspect the installed Production
function/grant catalog. Do not infer activation readiness from the direct-call
scanner alone.
