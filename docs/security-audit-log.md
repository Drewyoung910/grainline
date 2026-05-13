# Grainline Security Audit Log

Last updated: 2026-05-13

This is the working log for security hardening passes. Only verified findings should be promoted to `audit_open_findings.md`.

## Pass 1: Authorization And IDOR Inventory

Started: 2026-05-13

Initial inventory:

- API route handlers: 100
- Files containing server actions: 20
- Test files: 117

Mechanical sweeps started:

- Dynamic route parameters and body/search IDs.
- Prisma `where: { id }` reads/mutations.
- Server actions with `"use server"`.
- Middleware-public routes vs route-local authentication.

Spot checks completed in this pass:

- `src/app/api/reviews/[id]/route.ts`
  - PATCH/DELETE resolve Clerk user to local `User`.
  - Banned/deleted users are blocked.
  - Review owner check (`review.reviewerId === me.id`) is enforced before edit/delete.
  - Result: no verified IDOR found.

- `src/app/api/orders/[id]/fulfillment/route.ts`
  - Resolves Clerk user, blocks banned/deleted users, resolves seller profile.
  - `ensureSellerOwnsOrder()` requires at least one order item to belong to that seller before fulfillment mutation.
  - Blocks active cases/refunded orders and invalid state transitions.
  - Result: no verified IDOR found in the inspected section.

- `src/app/api/commission/[id]/route.ts`
  - GET is intentionally public but hides missing, banned/deleted buyer, and expired requests.
  - PATCH requires auth, local user, non-banned/non-deleted account, buyer ownership, OPEN status, and non-expired state.
  - Result: no verified IDOR found in the inspected section.

- `src/app/api/cases/[id]/mark-resolved/route.ts`
  - Requires auth and local user.
  - Requires requester to be buyer or seller on the case.
  - Final SQL update repeats participant and status predicates atomically.
  - Result: no verified IDOR found.

Open work:

- Continue route-by-route audit for the remaining dynamic private routes.
- Prioritize messages, orders/refunds/labels, cases/resolve, account deletion/export, seller settings, listing edit/create, favorites/saved searches, and admin actions.
- Add regression tests for each verified issue before or with the fix.
