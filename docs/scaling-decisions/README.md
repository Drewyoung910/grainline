# Scaling Decision Records

This directory is the durable home for decisions that are intentionally safe
at the current scale but must be revisited as Grainline grows. It exists so a
deferred scale change is not mistaken for forgotten work.

Each record must state:

1. the current architecture and why it is acceptable now;
2. what has already been implemented to make later growth safe;
3. measurable review triggers;
4. the intended next architecture;
5. shortcuts that must not be used;
6. the security, migration, and rollback boundaries.

Review these records before changing a hot path, increasing provider capacity,
running a growth campaign, or claiming a user-count target is supported.
Update the relevant record whenever production evidence changes the decision.
Do not delete superseded reasoning; mark it superseded and link to the newer
record.

## Current records

- [Messaging, support, and case threads](messaging.md) — conversation identity,
  long-thread reads, search, realtime delivery, staff outreach, and dispute
  separation.

## Interpretation

Registered-account count, monthly active users, simultaneous requests, open
streams, database connections, and fanout volume are different capacity
dimensions. A statement that storage and bounded reads are suitable for 50,000
registered accounts is not a promise that 50,000 users can hold message streams
open at once.

These records are review triggers, not authorization to weaken RLS, broaden a
runtime role, skip source validation, or combine unrelated production
activations.
