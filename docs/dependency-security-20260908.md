# Dependency refresh and MapLibre 6 compatibility

## Scope

Isolated from the Order RLS candidate. This patch does not change migrations,
database authority, credentials, provider configuration, or production state.
It is not permission to merge or deploy.

Reviewed package resolutions: Next and eslint-config-next 16.3.3, Sharp 0.35.4,
MapLibre 6.4.1, the complete Tiptap family 3.31.3, and js-yaml 4.3.2.
Existing Prisma versions and security overrides are preserved. Tiptap uses one
coherent family including its optional menu peers; the first attempted 3.30.5
resolution mixed those peers with 3.31.3 and was not accepted.

The local 2026-09-08 audit passed the unchanged high/critical gates. Two moderate
package entries remain (`@humanfs/node` and `qs`); this is not a zero-advisory
claim. They are outside this targeted blocking-advisory patch and must remain
visible in dependency review rather than being suppressed.

## Map architecture contract

- All five map components import the namespace from `src/lib/maplibreClient.ts`.
  MapLibre 6 no longer provides the old default export.
- `scripts/prepare-maplibre-assets.mjs` copies the locked worker and shared ESM
  module together into `public/vendor/maplibre/<version>/`. The generated files
  retain upstream license headers and are not committed.
- `npm run dev` prepares these files through `predev`; `npm run build` prepares
  them after Prisma generation and before Next's build. When invoking Next
  directly, run the preparation script first.
- Worker URLs are same-origin and version-matched to the main-thread library.
  No CDN worker, new CSP permission, or authentication bypass is introduced.
- MapLibre 6 requires WebGL 2. The shared support helper probes it and releases
  the temporary context; unsupported devices retain the existing fallback.
  Privacy-radius maps must still hide exact coordinates in that fallback.
- Existing marker/card behavior, clustering, location picking, and map styles
  are retained. WebGL 1-only devices deliberately receive the fallback.

## Verification and release gates

The focused dependency tests exercise the attribute-merge and YAML-budget
regressions, legitimate controls, native image decoding/encoding, aligned editor
peers, and byte-identical worker assets. Existing map/privacy/editor tests remain
required. The audit script is unchanged: both production and full trees reject
every high/critical advisory.

Local browser fixtures belong in ignored `.local-proofs/`, excluded from lint,
typechecking, and Vercel uploads. They must contain synthetic data only, no
credentials or production database access. Browser validation must check worker
and shared-module requests, all five map consumers, unsupported-GPU fallbacks,
attribution sanitization, and normal editor input.

The normal full test suite, TypeScript, lint, dependency audits, clean install,
and CI production build must pass before release acceptance. A local webpack
compatibility proof does not replace the normal Turbopack CI build. Browser
coverage on Chromium does not constitute a Safari/device matrix.

After this isolated dependency change is accepted, return to the preserved
Order authority execution-fencing checkpoint. Do not fold additional RLS work
into this patch or mistake dependency acceptance for RLS activation.
