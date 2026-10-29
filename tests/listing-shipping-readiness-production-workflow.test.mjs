import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  migrationChecksum,
  migrationName,
  sourceForDelimiter,
} from "../scripts/listing-shipping-readiness-production-inspect.mjs";

const workflow = readFileSync(
  ".github/workflows/listing-shipping-readiness-production.yml",
  "utf8",
);

test("C-264 release is manual, exact-main, exact-CI, and serialized", () => {
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-listing-shipping-readiness'/u,
  );
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /group: production-database-migrations/u);
  assert.match(
    workflow,
    /main\.commit\.sha !== sha[\s\S]*run\.path !== '\.github\/workflows\/ci\.yml'[\s\S]*run\.event !== 'push'[\s\S]*run\.head_sha !== sha[\s\S]*run\.conclusion !== 'success'/u,
  );
  assert.match(workflow, /Exact-main push workflows are not all green/u);
});

test("C-264 release pins the sole migration and supports ledger recovery", () => {
  assert.equal(
    migrationName,
    "20261027060000_enforce_listing_shipping_readiness",
  );
  assert.equal(
    migrationChecksum,
    "e654d44d00410d29d79505b6a6445d40d3d3fb85b5c51d5e3b85104fd15714da",
  );
  assert.match(workflow, new RegExp(migrationName, "u"));
  assert.match(workflow, new RegExp(migrationChecksum, "u"));
  assert.match(
    workflow,
    /MIGRATION_STATE" == "pending" \|\| "\$MIGRATION_STATE" == "applied-unrecorded"[\s\S]*REVIEWED_PENDING_MIGRATIONS="\$migration"/u,
  );
  assert.match(
    workflow,
    /Apply reviewed C-264 transaction outside Prisma ledger[\s\S]*if: steps\.preflight\.outputs\.state == 'pending'[\s\S]*psql "\$DIRECT_URL"/u,
  );
  assert.match(
    workflow,
    /Record applied or forward-recovered C-264 migration[\s\S]*if: steps\.preflight\.outputs\.state != 'applied'[\s\S]*prisma migrate resolve --applied/u,
  );
});

test("C-264 inspector pins all three promoted function bodies", () => {
  for (const delimiter of [
    "$grainline_listing_shipping_ready$",
    "$grainline_seller_owner_onboarding_complete$",
    "$grainline_seller_staff_listing_review_transition$",
  ]) {
    const source = sourceForDelimiter(delimiter);
    assert.ok(source.length > 50);
    assert.doesNotMatch(source, /CREATE OR REPLACE FUNCTION/u);
  }
  assert.match(
    workflow,
    /Read back exact functions, owners, ACLs, and ledger/u,
  );
  assert.match(workflow, /Audit global runtime grants after C-264/u);
  assert.match(
    workflow,
    /if: always\(\)[\s\S]*actions\/upload-artifact@[0-9a-f]{40}/u,
  );
});

test("C-264 release does not deploy app code or widen database authority", () => {
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.doesNotMatch(
    workflow,
    /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON/iu,
  );
});
