# Conversation and Message Authority Contract

Opened 2026-07-25. Status: recipient-read SQL is a disposable draft on
`codex/rls-conversation-message-authority-20260725`. It is not a Prisma
migration, is not applied to any persistent database and does not authorize
activation. The live production boundary remains RLS disabled with zero
Conversation/Message policies.

## Invariants shared by every public database operation

- `p_user_id` is always the server-resolved local `User.id`, never a route,
  form, query-string or webhook identity.
- Recipient projections are one-statement `SECURITY INVOKER` functions. They
  validate the same bounded user-id grammar as `dbUserContextState.ts`, set
  transaction-local `app.user_id`, and rely on RLS for row isolation.
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

## Fixed write catalog still required before activation

The fixed participant/message functions and all three structured creation
families are now drafted. They remain disposable proof SQL until the complete
catalog, race suite and application conversion pass:

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

All fixed service families are drafted. The remaining authority work is the
full race/lifecycle proof, legacy preflight for structured replay anchors,
application helper conversion, and a fresh review of the catalog as a set.

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
