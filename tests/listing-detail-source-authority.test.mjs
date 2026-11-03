import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("listing detail uses bounded actor and staff sources", async () => {
  const [migration, access, page, provision, scenario, runner] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/listingDetailAccess.ts", root), "utf8"),
    readFile(new URL("src/app/listing/[id]/page.tsx", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
    readFile(new URL("tools/database-full-chain/scenarios/listing-domain-detail-authorities.mjs", root), "utf8"),
    readFile(new URL("tests/database-full-chain-postgres.test.mjs", root), "utf8"),
  ]);

  const coreStart = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_detail_source_core(",
  );
  const actorStart = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_actor_detail_source(",
    coreStart,
  );
  const staffStart = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_staff_detail_source(",
    actorStart,
  );
  const staffEnd = migration.indexOf(
    "CREATE FUNCTION public.grainline_listing_owner_ai_review_context(",
    staffStart,
  );
  assert.ok(coreStart >= 0 && actorStart > coreStart && staffStart > actorStart);
  assert.ok(staffEnd > staffStart);

  const core = migration.slice(coreStart, actorStart);
  const actor = migration.slice(actorStart, staffStart);
  const staff = migration.slice(staffStart, staffEnd);
  assert.match(core, /listing\."archivedAt" IS NULL/u);
  assert.match(core, /'id', photo\.id/u);
  assert.match(core, /'url', photo\.url/u);
  assert.match(core, /'altText', photo\."altText"/u);
  assert.doesNotMatch(core, /originalUrl/u);
  assert.match(
    core,
    /REVOKE ALL ON FUNCTION public\.grainline_listing_detail_source_core\(text\)[\s\S]*FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime/u,
  );
  assert.match(actor, /grainline_seller_actor_listing_detail_profile\(\s*p_listing_id\s*\)/u);
  assert.match(actor, /GRANT EXECUTE[\s\S]*grainline_listing_actor_detail_source\(text\)[\s\S]*TO grainline_app_runtime/u);
  assert.match(staff, /grainline_seller_staff_listing_detail_profile\(\s*p_actor_id, p_listing_id\s*\)/u);
  assert.match(staff, /GRANT EXECUTE[\s\S]*grainline_listing_staff_detail_source\(text,text\)[\s\S]*TO grainline_staff_read_runtime/u);

  assert.match(access, /grainline_listing_actor_detail_source/u);
  assert.match(access, /grainline_listing_staff_detail_source/u);
  assert.match(page, /listingActorDetailSource\(viewerUserId, listingId\)/u);
  assert.match(page, /listingStaffDetailSource\([\s\S]*staffClient,[\s\S]*meId as string,[\s\S]*listingId/u);
  assert.doesNotMatch(page, /prisma\.listing\.findUnique/u);
  assert.match(
    provision,
    /public\."grainline_listing_actor_detail_source"\(text\)'\s*,\s*true/u,
  );
  assert.match(
    provision,
    /public\."grainline_listing_staff_detail_source"\(text, text\)'\)/u,
  );

  for (const expected of [
    "anonymous public detail",
    "owner hidden detail",
    "reserved buyer detail",
    "blocked pair detail",
    "staff hidden detail",
    "archived detail",
    "originalUrl",
  ]) {
    assert.match(scenario, new RegExp(expected, "u"));
  }
  assert.match(runner, /proveListingDomainDetailAuthorities/u);
});
