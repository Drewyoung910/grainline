# User installed catalog Production inspection

Date: 2026-10-07

## Purpose

This package prepares one read-only Production inspection for the complete
reviewed `User` authority catalog. It answers the open question that source and
disposable-database proof cannot answer: which reviewed migrations, function
bodies, and grants are actually installed in Production immediately before the
remaining User authority migrations are considered.

It does not apply SQL, change grants, read application rows, deploy code, or
enable/force User RLS.

## Catalog correction found during preparation

The prior global catalog contained 45 functions. It included the two seller
snapshot trigger functions but omitted the four blog and four
review/commission snapshot trigger functions even though the global grant
auditor separately classified those eight functions as runtime-private.

The canonical source catalog now contains **53 exact functions across 16
migrations**:

- 34 ordinary-runtime functions;
- nine isolated-staff private functions; and
- ten snapshot trigger functions that remain private from ordinary runtime,
  staff runtime, and `PUBLIC`.

This changes catalog completeness only. It does not grant execute authority or
alter a function body.

## Read-only inspection contract

`.github/workflows/user-installed-catalog-production-inspection.yml` is a
manual, first-attempt, exact-main workflow bound to a successful full push CI
run for the same immutable commit. The job uses the protected direct owner
connection only after the existing connection guard passes. The inspector then
opens a `REPEATABLE READ READ ONLY` transaction and rolls it back.

The inspection verifies:

1. the owner, ordinary runtime, and isolated staff role identities and their
   non-superuser/non-bypass posture;
2. the exact Prisma checksum, completion state, rollback state, and step count
   for every installed reviewed User migration;
3. that installed reviewed migrations form the exact eight-migration accepted
   Production prefix through public seller state, so a missing accepted family
   or prematurely installed successor fails closed;
4. the exact installed function overload set derived from that ledger prefix;
5. each function's owner, language, kind, SECURITY DEFINER flag, leakproof
   flag, volatility, parallel safety, fixed `search_path`, body MD5, dynamic
   `EXECUTE` posture, and complete non-owner ACL;
6. denial of every reviewed function to `PUBLIC`;
7. the exact runtime versus isolated-staff execute partition; and
8. the current `User` table posture: RLS off, FORCE off, zero policies,
   predecessor ordinary-runtime CRUD retained, no staff table access, no column
   ACLs, and no unexpected non-owner table grants.

Expected body hashes and migration checksums are derived from the exact checked
out source at the CI-bound commit. The retained artifact contains catalog
metadata and digests only: no database URL, credentials, function bodies,
application rows, user identifiers, or email addresses. It is created as a
mode-0600 file and retained for 30 days by the workflow artifact service.

## CI staging

The complete catalog tests run once while every staged User migration is
present, then move into the staff admin-label holding area before the historical
replay. They return only after the last staged User family is restored. This avoids
testing an intentionally incomplete migration tree during CI while preserving
the exact historical replay gates.

Focused proof covers source parsing, all 53 exact identities, migration-prefix
classification, exact table/function grants, body and overload drift,
premature RLS rejection, workflow immutability, fresh private evidence, and the
CI isolation/restore position.

## Release decision

**GO** for source publication and an exact-main, read-only Production inspection
after all predecessor source commits merge and the resulting main CI succeeds.

**NO-GO** for Production SQL, application deployment, User grant revocation,
policy creation, ENABLE, or FORCE. The installed-catalog gate closes only when
the workflow runs successfully and its sanitized artifact is read back. The
separate service-ledger scope decision remains in force; it does not call either
ledger hardened.

If the inspection confirms the expected eight-migration Production prefix, the
other eight reviewed source migrations are still unapplied. They require a
separately reviewed guarded prefix release, followed by compatible-app
promotion and smoke. Final grant/policy design and the separate ENABLE/FORCE
release remain later gates. A successful read-only inspection alone does not
make User RLS ready.

The guarded successor runner is now prepared in
`docs/user-authority-successor-production-release.md` on the same source
package. Keeping both workflows on one immutable main commit lets the mutation
runner require the successful read-only inspection's exact head SHA while
retaining separate dispatch approvals and evidence readbacks.
