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

1. Canonical create/get Conversation with sorted User locks, reciprocal block
   recheck and optional source-valid Listing context.
2. Ordinary text/file send deriving recipient, kind/system fields, Message
   time and thread state after the exact Conversation lock.
3. Participant-only archive/unarchive and recipient-only mark-read.
4. Source-Message-bound email throttle claim.
5. Buyer custom-order request with seller/listing source validation.
6. CommissionInterest/CommissionRequest-bound system Message.
7. Reserved private Listing-bound custom-order-ready Message with replay
   prevention.
8. Account-deletion media projection and fixed redaction bound to the deleting
   actor; no general body editor.
9. Aggregate-only seller response metrics.

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
