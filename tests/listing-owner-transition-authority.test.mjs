import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql",
  import.meta.url,
);
const accessPath = new URL("../src/lib/listingOwnerAccess.ts", import.meta.url);
const dashboardPath = new URL("../src/app/dashboard/page.tsx", import.meta.url);
const shopActionsPath = new URL("../src/app/seller/[id]/shop/actions.ts", import.meta.url);
const provisionPath = new URL("../scripts/provision-runtime-db-role.sql", import.meta.url);

test("simple owner listing transitions use one actor-bound locked authority", async () => {
  const [migration, access, dashboard, shopActions, provision] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(accessPath, "utf8"),
    readFile(dashboardPath, "utf8"),
    readFile(shopActionsPath, "utf8"),
    readFile(provisionPath, "utf8"),
  ]);

  assert.match(
    migration,
    /CREATE FUNCTION public\.grainline_listing_owner_transition\(\s*p_listing_id text,\s*p_operation text,\s*p_expected_updated_at timestamp without time zone\s*\)/u,
  );
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(
    migration,
    /p_operation NOT IN \('HIDE', 'MARK_SOLD', 'WITHDRAW_REVIEW', 'RETURN_TO_DRAFT'\)/u,
  );
  assert.match(migration, /FOR UPDATE/u);
  assert.match(migration, /source_listing\.status::text NOT IN \('ACTIVE', 'SOLD_OUT'\)/u);
  assert.match(migration, /source_listing\."updatedAt" IS DISTINCT FROM p_expected_updated_at/u);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_listing_owner_transition\(\s*text,text,timestamp without time zone\s*\)[\s\S]*TO grainline_app_runtime/u,
  );

  assert.match(access, /export function listingOwnerTransition\(/u);
  assert.match(access, /FROM public\.grainline_listing_owner_transition\(/u);
  assert.equal(dashboard.match(/listingOwnerTransition\(me\.id,/gu)?.length, 2);
  assert.equal(shopActions.match(/listingOwnerTransition\(listing\.seller\.userId,/gu)?.length, 3);
  assert.match(
    provision,
    /public\."grainline_listing_owner_transition"\(text,text,timestamp without time zone\)'\s*,\s*true/u,
  );
});
