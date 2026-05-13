# Grainline Maintainability And Bug-Resistance Plan

Last updated: 2026-05-13

Grainline does not need a rewrite. It needs stabilization, clear ownership boundaries, and a stricter change discipline now that the product is close to commercial launch.

## Goals

- Make the codebase maintainable by a future development team.
- Keep `main` deployable.
- Reduce regressions from AI-assisted edits.
- Preserve working product behavior while improving structure.

## Current Assessment

The stack and architecture are commercially reasonable: Next.js, Prisma, Postgres, Clerk, Stripe, R2, Resend, Sentry, and Redis are normal production choices. The codebase has meaningful tests and detailed behavioral docs.

The maintainability risks are mostly from eight months of rapid iteration:

- Some files are too large.
- Some flows have been patched many times.
- Some behavior contracts live only in long audit history.
- Similar authorization/visibility/payment patterns are repeated in multiple surfaces.
- AI-generated changes sometimes fix the local symptom while shifting behavior elsewhere.

This is a consolidation problem, not a rewrite problem.

## Stabilization Rules

- Freeze broad product churn during security hardening.
- Prefer small commits with one behavioral purpose.
- Do not deploy from non-main branches to production.
- Every high-risk fix needs a regression test.
- Every behavior-changing fix updates `CLAUDE.md` or a focused doc.
- Every security finding must be verified before it becomes a fix.
- Keep rollback possible: forward fixes over history rewrites.

## Change Review Checklist

Before merging:

- Does this change alter auth, payments, uploads, messages, listing state, order state, or account deletion?
- If yes, is the behavior documented?
- Is there a regression test for the bug or contract?
- Did the change preserve public visibility helpers?
- Did it avoid touching unrelated modules?
- Did it preserve existing user workflows?
- Did it run `npm test`, `tsc`, lint, build, audit, and `git diff --check`?
- Is the final summary specific enough that a future engineer can understand why the change exists?

## AI-Assisted Development Rules

- AI may propose findings, but code evidence decides.
- No fix should be made from a screenshot or prompt alone when code can be inspected.
- False positives should be recorded when they are likely to recur.
- AI should not "modernize" or "simplify" payment, auth, or legal flows without explicit scope.
- If a fix changes workflow semantics, stop and verify the product intent.
- When using AI for audits, require exact files, exploit shape, and a minimal patch plan.

## Refactor Priorities

Tackle only after security launch blockers are closed:

1. **Stripe webhook split**
   - Keep event-specific handlers in smaller files.
   - Preserve idempotency and event-shape tests.

2. **Email module split**
   - Separate templates, composers, direct sends, and outbox behavior.
   - Keep transactional-vs-bulk behavior explicit.

3. **Listing edit/create flow**
   - Clarify staged vs persisted edits.
   - Make photo, variant, alt text, save, and AI review boundaries obvious.

4. **Seller profile page**
   - Split query building from presentation.
   - Keep layout rhythm and sticky sidebar behavior testable.

5. **Upload/crop flow**
   - Keep endpoint rules centralized.
   - Make crop, recrop, original URL preservation, and single/multi-file behavior explicit.

6. **Authorization helpers**
   - Convert repeated owner/staff predicates into shared helpers where the pattern is stable.
   - Avoid clever abstractions until at least two real call sites match.

## Documentation Plan

- `docs/architecture.md`: onboarding map for developers.
- `docs/security-hardening-plan.md`: adversarial security workflow and RLS stance.
- `docs/maintainability-plan.md`: stabilization and refactor plan.
- `docs/legal-risk-register.md`: legal/compliance tracker for attorney review.
- `CLAUDE.md`: detailed behavior contracts and implementation memory.
- `CLOSED_AUDIT_HISTORY.md`: archived historical audit logs.
- `audit_open_findings.md`: verified findings and status changes.

## Team Handoff Standard

A new engineer should be able to:

1. Read `README.md`.
2. Read `docs/architecture.md`.
3. Read the relevant behavior section in `CLAUDE.md`.
4. Run the verification commands.
5. Make a scoped change.
6. Add or update tests.
7. Explain the behavioral impact in the PR.

If a future engineer cannot do that, the problem is documentation or module boundaries, not a reason to rewrite the product.
