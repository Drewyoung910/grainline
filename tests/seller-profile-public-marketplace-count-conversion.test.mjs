import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const callers = [
  "src/app/about/page.tsx",
  "src/app/why-grainline/page.tsx",
  "src/app/why-sell-on-grainline/page.tsx",
  "src/lib/homepageStats.ts",
].map((path) => [path, readFileSync(path, "utf8")]);

test("public marketplace count callers use the bounded aggregate authority", () => {
  for (const [path, source] of callers) {
    assert.match(source, /sellerPublicMarketplaceCounts\(\)/u, path);
    assert.doesNotMatch(source, /prisma\.sellerProfile\.(count|findMany|findFirst|findUnique)\(/u, path);
  }
});

test("marketplace count authority preserves each predecessor count scope", () => {
  const migration = readFileSync(
    "prisma/migrations/20261019060000_prepare_seller_profile_public_marketplace_counts/migration.sql",
    "utf8",
  );
  assert.match(migration, /seller\."ownerAccountActive" = true[\s\S]*seller\."chargesEnabled" = true[\s\S]*seller\."stripeAccountSupported" = true[\s\S]*seller\."vacationMode" = false/u);
  assert.match(migration, /listing\.status::text = 'ACTIVE'[\s\S]*listing\."isPrivate" = false[\s\S]*listing\."archivedAt" IS NULL/u);
  assert.match(migration, /count\(\*\) FILTER \(\s*WHERE seller\."isFoundingMaker" = true\s*\)/u);
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|REVOKE [^\n]+ ON TABLE/u);
});
