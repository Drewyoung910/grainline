import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/order-post-force-application-corrections-production.yml",
  "utf8",
);

test("post-FORCE corrections workflow is manual, exact-main and Production-bound", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-order-post-force-application-corrections'/,
  );
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.run_attempt == 1/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /group: production-database-migrations/);
  assert.match(
    workflow,
    /actions\/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b/,
  );
  assert.match(
    workflow,
    /main\.commit\.sha !== sha[\s\S]*run\.event !== 'push'[\s\S]*run\.head_branch !== 'main'[\s\S]*run\.head_sha !== sha[\s\S]*run\.conclusion !== 'success'/,
  );
});

test("workflow admits only the exact two checksummed post-FORCE migrations", () => {
  assert.match(
    workflow,
    /ceef219897013aa84bec0155f23e0ce01d8c48472d6e8bcb166e713d1e4edd96\s+prisma\/migrations\/20260930030000_bound_listing_fulfillment_days\/migration\.sql/,
  );
  assert.match(
    workflow,
    /0a1cb4828cce4d05abf783b12d790c13581fb7698f8063aaeaf92b5fa8c6bee1\s+prisma\/migrations\/20260930031000_mark_paid_private_listing_sold\/migration\.sql/,
  );
  assert.match(workflow, /tail -n 2/);
  assert.match(
    workflow,
    /Require every predecessor applied and no other pending migration[\s\S]*npx prisma migrate status[\s\S]*Apply only the reviewed post-FORCE migrations/,
  );
});

test("preflight rejects incompatible rows and postflight proves bounded state", () => {
  assert.match(
    workflow,
    /"shipsWithinDays" < 1 OR "shipsWithinDays" > 365/,
  );
  assert.match(workflow, /Listing_ships_within_days_valid_chk/);
  assert.match(workflow, /grainline_stripe_checkout_order_create/);
  assert.match(workflow, /assert\.equal\(authority\.rows\[0\]\.runtime_execute, true\)/);
  assert.match(workflow, /assert\.equal\(authority\.rows\[0\]\.public_execute, false\)/);
  assert.match(workflow, /assert\.deepEqual\(after\.rows, before\)/);
  assert.doesNotMatch(workflow, /provision-runtime-db-role\.sql/);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/i);
});
