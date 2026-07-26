# Conversation and Message Authority Contract

Opened 2026-07-25. Status: the complete recipient/fixed-service authority
catalog passed disposable PostgreSQL and full CI at `7a7654c3` in run
`30180610380`. The exact 25-function, functions-only candidate is now generated
from byte-pinned sources as
`20260726022500_prepare_conversation_message_authority`, disposable SHA-256
`9b56eb4c0e25e5de5266998f29a19fb0c7173c49f2b83266f3223542c7feeb07`.
It is not yet a promoted release and is not applied to any persistent database.
Candidate CI must prove old direct CRUD, new fixed calls, exact ACL/catalog
state, RLS disabled and zero policies before the executable bytes may be
promoted. The live production boundary remains RLS disabled with zero
Conversation/Message policies.

## Invariants shared by every public database operation

- `p_user_id` is always the server-resolved local `User.id`, never a route,
  form, query-string or webhook identity.
- Recipient projections are one-statement `SECURITY INVOKER` functions. They
  validate the same bounded user-id grammar as `dbUserContextState.ts`, set
  transaction-local `app.user_id`, and rely on RLS for row isolation.
- The three id-addressed read projections also repeat the participant or exact
  reported-staff predicate inside their query. This preserves authorization
  during the compatible-app window before RLS is enabled; disposable proof
  must disable RLS and still reject a foreign Conversation, Message list and
  latest custom-order request through those functions.
- A direct runtime table query without context must return zero rows.
- A participant may read only a Conversation they belong to and Messages whose
  immutable sender/recipient pair proves the same membership.
- Non-participant staff visibility is read-only, requires an active
  `EMPLOYEE`/`ADMIN` plus an unresolved `MESSAGE_THREAD` report for the exact
  Conversation, and disappears as soon as that report resolves.
- There is no general admin, cron or runtime bypass.
- Direct runtime Conversation/Message `INSERT`, `UPDATE` and `DELETE` are
  revoked at activation. Every write is a separately reviewed fixed operation.

## Recipient read catalog

| Function | Runtime consumer | Authority result |
|---|---|---|
| `grainline_conversation_inbox` | `/messages` | Bounded 51-row keyset page, latest Message, unread count, listing preview, block/archive/search filters |
| `grainline_conversation_get` | Thread page, list/read routes, custom-listing validation | One participant or exact reported-staff Conversation metadata row |
| `grainline_conversation_pair` | New-message and order fallback links | Existing canonical participant pair only |
| `grainline_message_list` | Initial history, list polling and SSE polling | Bounded before/after keyset window; staff authority is re-evaluated per statement |
| `grainline_message_unread_count` | Header unread API | Recipient-only unread rows in visible, unblocked, unarchived threads |
| `grainline_message_latest_custom_request` | Custom-listing form | Latest fixed-kind request in a visible thread |
| `grainline_message_report_target_valid` | User report route | Boolean for an exact visible Message or Conversation involving the reported account |
| `grainline_message_export` | Account export | Only rows where the actor is immutable sender or recipient |

The sole definer read helper,
`grainline_conversation_staff_report_visible`, derives its actor from
`app.user_id` and returns one boolean. It exposes no User, UserReport,
Conversation or Message row.

## Fixed write catalog and proof status

The fixed participant/message functions and all three structured creation
families are now drafted and have passed the complete disposable catalog and
race proof. They remain disposable SQL until the protected legacy inspection,
functions-only promotion, compatible application conversion and final
activation review pass:

1. `grainline_conversation_start`: canonical create/get Conversation with
   sorted User locks, reciprocal block recheck and optional source-valid
   Listing context.
2. `grainline_message_send_ordinary`: ordinary text/file send deriving
   recipient, kind/system fields, Message time and thread state after the exact
   Conversation lock.
3. `grainline_conversation_set_archived`: participant-only archive/unarchive.
4. `grainline_message_mark_read`: recipient-only mark-read.
5. `grainline_conversation_claim_message_email`: source-Message-bound email
   throttle claim.
6. `grainline_message_send_custom_request`: buyer-authored request with locked
   seller state, optional public seller Listing, fixed kind and derived route.
7. `grainline_message_create_commission_interest`: atomically creates the
   CommissionInterest and its fixed system Message from the locked open
   CommissionRequest and seller profile.
8. `grainline_message_send_custom_order_ready`: derives its exact
   seller/buyer/conversation/payload and replay identity from the locked
   reserved private Listing.

9. `grainline_message_redact_for_account_deletion`: derives its redaction
   needles from the locked deleting User, seller profile and non-colliding
   email history; it can only replace that actor's sent bodies with the fixed
   deletion marker and redact those derived values from received bodies. Its
   text/email helpers are owner-private, and there is no message-id or
   caller-authored replacement input.
10. `grainline_seller_message_response_metrics`: returns only bounded-window
    buyer-initiated and seller-responded aggregate counts; it exposes no
    Conversation id, Message id or body.

An ordinary composer submission may contain several attachment Messages plus
one text Message. Application conversion must keep all corresponding function
calls and `DirectUpload` claims in the existing single `READ COMMITTED`
transaction, with one generated UUID per Message, and emit Notification/email
side effects only after that transaction commits. The fixed function protects
one row per call; it does not authorize weakening batch atomicity or the
existing first-party upload verification/claim checks.

All fixed service families and both lock orderings for block, deletion,
mark-read and archive races first passed at `940fcf2c` in GitHub Actions run
`30179962784`. The later accepted proof below adds the exact aggregate-only
legacy query, compatibility-window scope and malformed-payload handling. The
remaining release work is the narrowly classified legacy cleanup and zero-count
postflight, functions-only promotion, application conversion and a fresh
activation review of the promoted catalog as a set.

The first exact-query proof at `fb0e8dcb` is retained as failed GitHub Actions
run `30180176533`: PostgreSQL 16 rejected an incorrect `regtype` argument to
`pg_input_is_valid` with `42883`. No persistent database was touched. The
candidate now passes text arguments to the catalog function and requires a
fresh full proof; the failed run is not reinterpreted as passing evidence.

The corrected query compiled at `359ac058` in failed run `30180295405` and
returned zero invalid, duplicate, missing and orphan structured-source counts.
The proof then caught an incorrect fixture expectation: custom-request creation
had correctly attached one validated Listing to its existing Conversation, so
`contextConversationCount` was one rather than zero. That expectation is
corrected only in a fresh candidate; this second failed run also remains failed
evidence and touched no persistent database.

The accepted fresh proof at `7a7654c3` applied all 25 exact public/private
functions, two policies and SELECT-only table grants to disposable PostgreSQL
16. It proved direct no-context denial, participant isolation, exact
reported-staff access and revocation, all fixed write/source/replay families,
owner-private cores, account redaction, aggregate-only metrics, and both real
lock-wait orderings for block/send, deletion/send, mark-read/send and
archive/send. It also disabled RLS and proved that the three id-addressed
compatibility projections still reject foreign rows, compiled the exact
production aggregate query, treated malformed structured payloads as invalid
evidence without exporting them, and required the exact aggregate result
schema. TypeScript, lint, the full test suite, dependency audit and production
build all passed. Production and persistent staging were unchanged.

The first protected production legacy inspection ran from exact merged main
`aa487bfb` in GitHub Actions run `30181030719`. It used one
`REPEATABLE READ READ ONLY` transaction and rolled back, then uploaded only
sanitized aggregate evidence as artifact `8625562386` (zip SHA-256
`a23e32bbe9b5d27993b5ef28cd259aec5d1fb56e779f60adb9d87c624dae6dd2`).
It confirmed the reviewed pre-RLS posture: owner-owned tables, runtime
`NOBYPASSRLS`, RLS and FORCE disabled, zero policies and legacy runtime CRUD
still present. Across four Conversations and 19 Messages, all participant,
canonical-pair, time, presentation, commission, report and private-listing
relationship violation counts were zero except one historical
`custom_order_link`: the sole link has no `Message.contextListingId`, so both
`customLinkMissingContextCount` and `invalidCustomLinkSourceCount` are one.
No ids, bodies, emails, raw rows or credentials were retained.

That row was not authority to infer arbitrary historical message context. A
second protected aggregate-only inspection from exact merged main
`09222adb3f693d6845d939a6b91766eb91b50444` ran in GitHub Actions
`30182892742`, retained sanitized artifact `8626117408` (zip SHA-256
`c2df2a5d4e01c7c75333171875a6a4071508ca095a18726a06f1dad545b2c157`),
and split missing custom-link context into:

- repairable only when a valid JSON `listingId` resolves to one private Listing
  whose seller, reserved buyer and custom-order Conversation exactly match the
  Message sender, recipient and Conversation; and
- unrepairable for every other missing-context link.

The result was exactly one repairable, zero unrepairable, one total missing and
zero duplicate custom-link source groups; every other relationship/source count
remained zero. No ids, bodies, emails, raw rows or credentials were retained.
The separately approved cleanup candidate
`20260726013500_repair_legacy_custom_order_link_context` therefore updates only
that fully source-bound row class, fails closed for more than one candidate or
any unrepairable candidate, and asserts zero missing, invalid or duplicate
custom-link sources before commit.

That cleanup is complete in production. Exact branch head `a4422716` passed
PostgreSQL 16 and all CI gates in run `30183476773`; PR `#46` merged as exact
main `ac1f519e5eba3839640f366e13dc4486f3a0d3d5`, whose full main CI run
`30183620261` also passed. Protected production migration run `30183709885`
applied only
`20260726013500_repair_legacy_custom_order_link_context`, reported the migration
ledger up to date and passed the final runtime grant/RLS catalog audit.

The required protected aggregate-only postflight ran from that same exact main
in `30183765803`. Four Conversations and 19 Messages remained; the single
custom-order link now has its exact validated Listing context. Missing,
repairable, unrepairable, invalid and duplicate custom-link source counts are
all zero, and every other participant, relationship, source, report and private
listing anomaly count remains zero. Conversation/Message RLS and FORCE remain
disabled with zero policies and legacy runtime CRUD retained. The read-only
repeatable-read run retained no ids, bodies, emails, rows or credentials and
uploaded artifact `8626401695` with zip SHA-256
`e0b4a321c0c5e3c82c14127983eb9d059b2087c3867acc307a08f10b9f57a569`.
Functions-only authority promotion is now the next gate; this evidence does not
authorize policy/grant activation.

The candidate builder refuses source-byte drift and extracts only the function
definitions and function ACLs from
`conversation-message-recipient-access.sql` and
`conversation-message-service-authority.sql`. It rejects any Conversation or
Message table `ALTER`, policy, table grant or table revoke in those sources.
The disposable migration adds a role/RLS/policy/invariant-trigger preflight and
an exact 25-signature, owner, security mode, volatility, parallel-safety,
`search_path` and ACL postflight. Its CI staging target is loopback
`grainline_ci` only; this checkpoint changes neither production nor persistent
staging.

## Cross-group dependencies to retain

- `grainline_message_create_commission_interest` is the atomic writer for both
  `CommissionInterest`/`CommissionRequest` and its Message. A later commission
  RLS rollout must preserve and re-review this exact source-bound path instead
  of granting broad commission-table writes or creating a second message path.
- Custom-order request and ready-link functions read locked
  `SellerProfile`/`Listing` sources but write only Conversation/Message. Later
  SellerProfile or Listing RLS must preserve those definer reads and their
  seller/reservation predicates.
- Account-deletion redaction derives its fixed needles from User,
  UserEmailAddress and SellerProfile. Later RLS or grant narrowing on those
  tables must keep this deletion-only projection working without widening it
  into a general body editor.
- Notification source functions validate Message/Conversation rows through
  separately reviewed fixed source functions. Conversation/Message activation
  must re-run Notification FORCE equivalence, but it must not grant Notification
  or runtime a general message bypass.
- Recipient inbox/unread projections currently join User, Block, Listing and
  Photo under `SECURITY INVOKER`; the exact reported-staff predicate reads User
  and UserReport under its narrow boolean-only definer boundary. Later RLS or
  grant narrowing for any of those tables must preserve these projections with
  a reviewed narrow interface. Do not solve the dependency by giving the
  runtime broad cross-table read authority.
- Every send/start family relies on the sorted User-pair lock protocol shared
  with `blockMutationAccess.ts`. Later User or Block write-authority work must
  preserve the same lock ordering, including account deletion, or repeat all
  block/send and deletion/send race proofs.

The caller may necessarily provide user-authored body/attachment content, but
may never choose a recipient, structured authority kind, system flag, canonical
link, durable source relationship, or replay identity.

## Release sequence

1. Prove recipient draft syntax, RLS isolation, reported-staff revocation,
   direct no-context denial and plan shape in disposable PostgreSQL.
2. Design and prove every fixed write family, race, cleanup and metric.
3. Promote functions only in an RLS-off preparation migration.
4. Apply preparation through the protected production workflow.
5. Deploy the compatible app using only the prepared functions.
6. Re-run authenticated behavior smoke while RLS is still off.
7. Activate both tables together with `ENABLE`/explicit `NO FORCE`, two exact
   SELECT policies and SELECT-only table grants.
8. Run direct-denial and authenticated postflight, then separately promote
   `FORCE ROW LEVEL SECURITY` with a fresh proof.

Orders, payments, shipping and Case/CaseMessage remain separate later
activation groups.
