import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("staff Listing references and verification counts use isolated bounded authorities", async () => {
  const [
    migration,
    access,
    reports,
    verification,
    provision,
    staffProvision,
    runner,
  ] = await Promise.all([
    readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
    readFile(new URL("src/lib/listingStaffAccess.ts", root), "utf8"),
    readFile(new URL("src/app/admin/reports/page.tsx", root), "utf8"),
    readFile(new URL("src/app/admin/verification/page.tsx", root), "utf8"),
    readFile(new URL("scripts/provision-runtime-db-role.sql", root), "utf8"),
    readFile(new URL("scripts/provision-order-staff-read-role.sql", root), "utf8"),
    readFile(new URL("tests/database-full-chain-postgres.test.mjs", root), "utf8"),
  ]);

  assert.match(migration, /CREATE FUNCTION public\.grainline_listing_staff_reference_targets\(/u);
  assert.match(migration, /CREATE FUNCTION public\.grainline_listing_staff_seller_active_public_count\(/u);
  assert.match(migration, /SESSION_USER <> 'grainline_staff_read_runtime'/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.grainline_listing_staff_reference_targets\([\s\S]*TO grainline_staff_read_runtime/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.grainline_listing_staff_seller_active_public_count\([\s\S]*TO grainline_staff_read_runtime/u);

  assert.match(access, /export async function listingStaffReferenceTargets/u);
  assert.match(access, /export async function listingStaffSellerActivePublicCount/u);
  assert.match(reports, /listingStaffReferenceTargets\(staffClient,[\s\S]*actorId: staff\.id/u);
  assert.doesNotMatch(reports, /prisma\.listing\.findMany\(/u);
  assert.match(verification, /listingStaffSellerActivePublicCount\(getOrderStaffReadClient\(\),[\s\S]*actorId: me\.id/u);
  assert.doesNotMatch(verification, /prisma\.listing\.count\(/u);

  assert.match(provision, /public\."grainline_listing_staff_reference_targets"\(text, text\[\]\)/u);
  assert.match(provision, /public\."grainline_listing_staff_seller_active_public_count"\(text, text\)/u);
  assert.match(staffProvision, /public\."grainline_listing_staff_reference_targets"\(text, text\[\]\)/u);
  assert.match(staffProvision, /public\."grainline_listing_staff_seller_active_public_count"\(text, text\)/u);
  assert.match(runner, /proveListingDomainStaffReferences/u);
});
