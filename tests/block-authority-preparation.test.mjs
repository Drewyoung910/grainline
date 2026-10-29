import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const migrationPath =
  "prisma/migrations/20261028050000_prepare_block_authorities/migration.sql";
const migration = fs.readFileSync(migrationPath, "utf8");

const convertedCallers = [
  "src/app/api/account/export/route.ts",
  "src/app/api/commission/[id]/interest/route.ts",
  "src/app/api/favorites/route.ts",
  "src/app/api/messages/custom-order-request/route.ts",
  "src/app/api/users/[id]/block/route.ts",
  "src/app/messages/[id]/page.tsx",
  "src/app/messages/new/page.tsx",
  "src/lib/accountDeletion.ts",
  "src/lib/blockAccess.ts",
  "src/lib/blockMutationAccess.ts",
  "src/lib/checkoutBlockState.ts",
];

function source(path) {
  return fs.readFileSync(path, "utf8");
}

function functionBody(name) {
  const start = migration.indexOf(`CREATE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `${name} must be created`);
  const marker = `$${name}$;`;
  const end = migration.indexOf(marker, start);
  assert.ok(end > start, `${name} must have a complete definition`);
  return migration.slice(start, end + marker.length);
}

describe("Block compatible authority preparation", () => {
  it("keeps activation and destructive changes out of the preparation migration", () => {
    assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY/u);
    assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/u);
    assert.doesNotMatch(migration, /REVOKE [^;]* ON TABLE public\."Block"/u);
    assert.doesNotMatch(migration, /DROP (?:TABLE|COLUMN)/u);
    assert.match(migration, /Block RLS must remain off during compatible preparation/u);
    assert.match(migration, /Block compatible preparation changed RLS posture/u);
  });

  it("provides only actor-bound fixed operations to the runtime role", () => {
    for (const name of [
      "grainline_user_block_pair_is_blocked",
      "grainline_user_block_create",
      "grainline_user_block_remove",
      "grainline_user_block_export",
      "grainline_user_block_delete_owned",
    ]) {
      const body = functionBody(name);
      assert.match(body, /SECURITY DEFINER/u, name);
      assert.match(body, /SET search_path = pg_catalog/u, name);
      assert.match(body, /current_setting\('app\.user_id', true\)/u, name);
      assert.match(
        migration,
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]*\\)\\s+FROM PUBLIC, grainline_app_runtime`, "u"),
        name,
      );
      assert.match(
        migration,
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]*\\)\\s+TO grainline_app_runtime`, "u"),
        name,
      );
    }
  });

  it("makes creation and reciprocal cleanup one serialized transaction", () => {
    const create = functionBody("grainline_user_block_create");
    const lock = create.indexOf("grainline_user_block_pair_lock(p_target_user_id)");
    const insert = create.indexOf('INSERT INTO public."Block"');
    const followCleanup = create.indexOf(
      "grainline_user_block_follow_cleanup(p_target_user_id)",
    );
    const stockCleanup = create.indexOf(
      "grainline_stock_notification_block_cleanup(p_target_user_id)",
    );
    assert.ok(lock >= 0 && lock < insert);
    assert.ok(insert < followCleanup && followCleanup < stockCleanup);
    assert.match(create, /ON CONFLICT \("blockerId", "blockedId"\) DO NOTHING/u);
  });

  it("pins messaging source before converting only its Block reads to fixed ownership", () => {
    assert.match(migration, /4b2884765f4ca0db432c4678f98b1bdd/u);
    assert.match(migration, /6465832d045b72cc2762907f66a461f3/u);
    assert.match(
      migration,
      /ALTER FUNCTION public\.grainline_conversation_inbox\([\s\S]*?\) SECURITY DEFINER;/u,
    );
    assert.match(
      migration,
      /ALTER FUNCTION public\.grainline_message_unread_count\(text\)\s+SECURITY DEFINER;/u,
    );
    assert.match(migration, /owner_role\.rolsuper OR owner_role\.rolbypassrls/u);
  });

  it("removes direct Block ORM access from every converted caller", () => {
    for (const path of convertedCallers) {
      assert.doesNotMatch(source(path), /(?:prisma|tx|client)\.block\./u, path);
    }
    assert.match(source("src/app/api/account/export/route.ts"), /ownerBlockExportRows\(user\.id\)/u);
    assert.match(source("src/lib/accountDeletion.ts"), /deleteAllOwnerBlocks\(tx\)/u);
    assert.match(source("src/lib/checkoutBlockState.ts"), /userBlockPairIsBlocked/u);
  });
});
