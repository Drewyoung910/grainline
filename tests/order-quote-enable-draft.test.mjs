import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ORDER_QUOTE_ENABLE_DRAFT,
  buildOrderQuoteRlsDraft,
} from "../scripts/build-order-quote-rls-draft.mjs";

test("quote ENABLE draft is pinned, policyless and successor-bound", () => {
  const release = buildOrderQuoteRlsDraft();
  assert.equal(release.draftSha256, ORDER_QUOTE_ENABLE_DRAFT.draftSha256);
  assert.match(release.draft, /OrderShippingRateQuote ENABLE/);
  assert.match(release.draft, /accepted OrderItem FORCE/);
  assert.match(release.draft, /accepted_functions <> 4/);
  assert.match(release.draft, /exact function catalog drifted/);
  assert.match(
    release.draft,
    /expected\(function_identity, source_md5, language_name, volatility, parallel_safety\)/,
  );
  assert.equal((release.draft.match(/, 'plpgsql', 'v', 'u'\)/gu) ?? []).length, 4);
  assert.doesNotMatch(release.draft, /actual\.lanname = 'plpgsql'/u);
  assert.match(release.draft, /trigger catalog drifted/);
  assert.doesNotMatch(release.draft, /CREATE POLICY|DROP POLICY/);
});

test("quote ENABLE rollback restores RLS-off without grants", () => {
  const { rollback } = buildOrderQuoteRlsDraft();
  assert.match(rollback, /DISABLE ROW LEVEL SECURITY/);
  assert.match(rollback, /retains accepted OrderItem FORCE/);
  assert.doesNotMatch(rollback, /\bGRANT\b/);
});
