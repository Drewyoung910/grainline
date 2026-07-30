# Case read-mode production release

Status: reviewed compatible candidate only. The migration is staged in the
repository for PostgreSQL and CI proof; it is not applied to production.
Case, CaseMessage and CaseMessageAttachment RLS remains off, FORCE remains
off, zero policies exist, and the predecessor runtime table grants remain
unchanged.

## Exact scope

This release adds exactly one migration:

- `20260730020000_converge_case_read_modes`
- source draft:
  `docs/rls-drafts/case-case-message-read-mode.sql`
- source draft SHA-256:
  `a0036ef86b4d92ce76d09dd0c799db83d3b7e192c9c4366aabd53ee070cdf973`
- migration SHA-256:
  `c237720b87ac81e03f6dd3558012076497b9d54412abdb71234c450ed36ee1a7`
- complete reviewed migration-tree SHA-256:
  `e0dfa816c70aa0aee6ccf3e6aa72e6412dc0e9f3d20413152caa236744dd6e4c`

`scripts/stage-case-read-mode-migration.mjs` byte-pins the accepted draft and
mechanically derives the migration. Verification is read-only. Staging or
unstaging requires an explicit acknowledgement and a loopback
`/grainline_ci` database URL; unstage refuses any drifted destination.

The migration changes only these exact functions from `SECURITY INVOKER` to
`SECURITY DEFINER`:

- `grainline_case_get(text,text)`
- `grainline_case_get_by_order(text,text)`
- `grainline_case_staff_active_count(text)`
- `grainline_case_export_page(text,timestamp,text,integer)`

It preserves the function bodies, pinned `search_path=pg_catalog`, owner,
volatility, parallel posture, bounded inputs and fixed outputs. It revokes and
regrants only the exact function EXECUTE privileges so `PUBLIC` remains
denied and `grainline_app_runtime` remains the sole runtime caller.
Because this release elevates the existing bodies, both migration preflight
and postflight pin the exact body digests, PL/pgSQL language, single-overload
catalog, direct non-grantable runtime EXECUTE, and absence of EXECUTE grants
to any other role.

The migration contains no function body replacement, dynamic SQL, RLS
statement, policy, Case-family table or column grant change, row DML,
application change, provider variable change, or deployment.

## Why this release is separate

The completed 80-reference inventory has 79 converted references plus one
retired unused helper. Ordinary application access uses 27 reviewed fixed
operations. Four bounded Case projections were originally INVOKER and would
therefore stop working after the later policyless activation revokes direct
Case-family table privileges. Converging those four projections first keeps
the currently deployed application compatible with both the predecessor and
later activation postures.

This does not make the database authenticate the human actor. The pooled
runtime can still pass a syntactically valid local User id to any granted
function. Clerk authentication, server-side actor resolution, request-origin
controls, rate limits, staff re-verification and the session-bound staff PIN
remain load-bearing. The SQL independently validates current user state,
participant relationships and staff role, but it does not claim protection
against arbitrary compromise of the runtime process.

## Accepted predecessor

The required predecessor is the live invariant boundary recorded in
`docs/case-invariant-production-release.md`:

- exact production source
  `13091acd428d86aa7da8ada143695ed66a3c6947`;
- protected Production Migrations run `30552049441`, job `90902923987`;
- only `20260730010000_enforce_case_message_invariants` was applied;
- pooled-runtime postflight evidence
  `case-invariant-production-postflight-13091acd428d86aa7da8ada143695ed66a3c6947.json`;
- evidence SHA-256
  `e27f287d6cf797dc2bc91b5805322c633263a6202ecf9968365831d547646847`;
- RLS off, FORCE off, zero policies, and predecessor table CRUD retained.

## Required proof before any production migration

The candidate must pass:

1. byte-equivalence and migration-tree guards;
2. focused static staging, workflow, authority-catalog and postflight tests;
3. the full repository test, TypeScript, lint, dependency-audit and production
   build gates;
4. disposable PostgreSQL application of the full migration tree, including
   the complete Case authority/invariant/activation/rollback proof; and
5. an Extra-High SQL/ACL review of the exact candidate bytes.

The first PR CI run (`30556373625`, job `90917762851`) stopped in the
recipient-read PostgreSQL proof before any production action. The full
migration tree had correctly converted the three recipient-read functions to
DEFINER, while that older proof still expected their predecessor INVOKER
catalog posture. Review found the same stale predecessor expectation in the
later account-export proof. Both proof harnesses now require DEFINER, and the
release test pins both expectations so this migration-mode drift cannot recur
silently. This was proof-code drift, not a failed runtime authority check;
production was unchanged.

The subsequent Extra-High byte review found that the first candidate checked
function mode, owner and search path but did not bind the bodies being
elevated. Before any production use, the candidate was hardened to reject
source drift, extra overloads, language drift, inherited-only runtime access,
grant options, and unexpected role grants in both preflight and postflight.
That hardening changed the candidate and migration-tree hashes recorded above;
the earlier candidate bytes were never applied.

The first hardened PostgreSQL run (`30557800073`, job `90922664565`) then
failed closed while applying the candidate because the initial digest helper
excluded the delimiter-adjacent newlines that PostgreSQL preserves in raw
`pg_proc.prosrc`. No later proof step ran and production was unchanged. The
digest extractor now captures the exact bytes between the dollar-quote
delimiters, including both newlines; the release test recomputes all four
digests from their preparation migrations and requires each in both preflight
and postflight.

If it is later applied, rerun
`npm run ops:case-compatible-db-postflight` through the real pooled
`grainline_app_runtime` credential in a repeatable-read read-only transaction.
The postflight must prove the exact four functions are DEFINER, owner-held,
runtime-executable, not PUBLIC-executable and still pinned to
`search_path=pg_catalog`. It must also prove Case-family RLS remains off with
zero policies and unchanged predecessor CRUD. Retain sanitized mode-0600
evidence bound to the exact main commit and migration run.

Do not combine this migration with policyless ENABLE, table-grant revocation,
FORCE, Case-evidence enablement, a Vercel deploy, or provider changes. ENABLE
and FORCE remain separate later releases with their own live pooled-runtime
proofs.
