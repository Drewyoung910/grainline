# User source dependency security correction

## Confirmed blocker and scope

PR #525 head `e8fc3745` passed its early User dependency closure, historical
staff-login convergence, complete Tests phase, and three independent Order
checks. CI `37563575718` then failed the unchanged production dependency audit:
the lockfile contained Sharp 0.35.4 and source-map-js 1.2.1, each with a high
advisory. No ready/merge action was taken.

The [Sharp maintainer advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w)
identifies its librsvg dependency issue and patched Sharp 0.35.5. The
[source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) and
[maintainer release](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)
identify the indexed source-map offset denial of service and patched 1.2.2.
Installed dependency exposure is verified; no Grainline exploit was attempted
or claimed.

## Targeted correction

- Raise the existing direct Sharp development specification to `^0.35.5`;
  retain the existing `$sharp` override so every production/transitive consumer
  resolves one reviewed line.
- Resolve Sharp and all its matching native bindings to 0.35.5 and the matching
  libvips packages to 1.3.4.
- Pin the compatible transitive `source-map-js` patch to 1.2.2.
- Move the same unchanged security-audit command directly after CI installation,
  before the expensive historical replay and test phase.

Lockfile comparison shows only the root Sharp specification, Sharp's native
family and source-map-js changed. Next, Prisma, Clerk, Stripe, editor packages and
unrelated dependency resolutions are unchanged. No application source, SQL,
production operator, credential, deployment or RLS state is changed.

The existing exact expiring development-only advisory exception remains intact;
neither production high/critical findings nor other full-tree high/critical
findings receive an exception. No audit threshold or failure behavior is reduced.

## Validation and limitations

Twelve dependency hygiene cases passed. Two actual compatibility cases ran with
the patched libraries from an isolated synthetic proof install: Sharp reports
0.35.5, libvips 8.18.7 and librsvg 2.63.2; JPEG/PNG/WebP decoding, rotation and
encoding are preserved. Source-map-js rejects malformed, excessive and nested
offsets, handles ordinary mappings, and skips mappings beyond exhausted code.
A five-second child deadline bounds any synchronous hang.

The shared node_modules symlink was not replaced or modified. Only the two
patched packages were installed in the ignored proof directory. The copied
actual compatibility test retains its original source helper and resolves the
patched libraries there; unmodified dependencies resolve from the existing tree.
This local native result is macOS evidence, not a Linux or Production execution
claim.

After moving the audit earlier, the one changed ordering/failure guard passed
again. Targeted lint, diff checks and workflow parsing pass. The unchanged
`npm run audit:dependencies` passes both its production and full-tree gates;
this is no unreviewed high/critical finding, not a zero-advisory claim.

No successful User/Order database proof or full application batch was rerun
locally. A new exact-head four-check public gate is required before the
conditional source merge; compatible SQL installation, deployment and User RLS
activation remain separate decisions.
