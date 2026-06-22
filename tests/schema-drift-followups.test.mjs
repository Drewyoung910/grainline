import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function source(filePath) {
  return fs.readFileSync(new URL(`../${filePath}`, import.meta.url), "utf8");
}

function migrationFiles() {
  const dir = new URL("../prisma/migrations", import.meta.url);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      sql: fs.readFileSync(path.join(dir.pathname, name, "migration.sql"), "utf8"),
    }));
}

function normalizeOnDelete(value) {
  return value.toUpperCase().replace("SETNULL", "SET NULL");
}

function finalMigrationForeignKeys() {
  const constraints = new Map();

  for (const { name, sql } of migrationFiles()) {
    for (const statement of sql.split(";")) {
      const drop = statement.match(
        /ALTER TABLE\s+(?:"public"\.)?"([^"]+)"[\s\S]*?DROP CONSTRAINT(?: IF EXISTS)?\s+"([^"]+)"/i,
      );
      if (drop) constraints.delete(drop[2]);

      const add = statement.match(
        /ALTER TABLE\s+(?:"public"\.)?"([^"]+)"[\s\S]*?ADD CONSTRAINT\s+"([^"]+)"\s+FOREIGN KEY\s*\("([^"]+)"\)\s+REFERENCES\s+(?:"public"\.)?"([^"]+)"\("([^"]+)"\)\s+ON DELETE\s+(CASCADE|RESTRICT|SET NULL|NO ACTION)/i,
      );
      if (add) {
        constraints.set(add[2], {
          table: add[1],
          field: add[3],
          onDelete: normalizeOnDelete(add[6]),
          migration: name,
        });
      }

      const createTable = statement.match(/CREATE TABLE\s+(?:"public"\.)?"([^"]+)"/i);
      if (!createTable) continue;

      const inlineConstraintPattern =
        /CONSTRAINT\s+"([^"]+)"\s+FOREIGN KEY\s*\("([^"]+)"\)\s+REFERENCES\s+(?:"public"\.)?"([^"]+)"\("([^"]+)"\)\s+ON DELETE\s+(CASCADE|RESTRICT|SET NULL|NO ACTION)/gi;
      for (const inline of statement.matchAll(inlineConstraintPattern)) {
        constraints.set(inline[1], {
          table: createTable[1],
          field: inline[2],
          onDelete: normalizeOnDelete(inline[5]),
          migration: name,
        });
      }
    }
  }

  return constraints;
}

function schemaForeignKeys() {
  const schema = source("prisma/schema.prisma");
  const relations = [];
  let currentModel = "";

  for (const line of schema.split("\n")) {
    const model = line.match(/^model\s+(\w+)\s+\{/);
    if (model) currentModel = model[1];
    if (/^}/.test(line)) currentModel = "";

    const relation = line.match(
      /@relation\([^)]*fields:\s*\[([^\]]+)\][^)]*onDelete:\s*(\w+)/,
    );
    if (!currentModel || !relation) continue;

    const field = relation[1].split(",")[0].trim();
    relations.push({
      constraint: `${currentModel}_${field}_fkey`,
      model: currentModel,
      field,
      onDelete: normalizeOnDelete(relation[2]),
    });
  }

  return relations;
}

describe("schema drift follow-ups", () => {
  it("keeps schema onDelete declarations aligned with final migration constraints", () => {
    const finalDbConstraints = finalMigrationForeignKeys();
    const mismatches = [];

    for (const relation of schemaForeignKeys()) {
      const dbConstraint = finalDbConstraints.get(relation.constraint);
      if (!dbConstraint) {
        mismatches.push(`${relation.constraint}: missing database constraint`);
        continue;
      }
      if (dbConstraint.onDelete !== relation.onDelete) {
        mismatches.push(
          `${relation.constraint}: schema ${relation.onDelete}, migration ${dbConstraint.onDelete}`,
        );
      }
    }

    assert.deepEqual(mismatches, []);
  });

  it("restores and protects the raw-managed blog tag GIN index", () => {
    const events = [];
    for (const { name, sql } of migrationFiles()) {
      if (/DROP INDEX[\s\S]*"BlogPost_tags_gin_idx"/.test(sql)) {
        events.push({ name, type: "drop" });
      }
      if (/CREATE INDEX(?: CONCURRENTLY)? IF NOT EXISTS "BlogPost_tags_gin_idx"[\s\S]*USING GIN/.test(sql)) {
        events.push({ name, type: "create" });
      }
    }

    assert.equal(events.at(-1)?.type, "create");
    assert.equal(events.at(-1)?.name, "20260521154500_schema_drift_and_raw_index_followups");
  });

  it("protects raw-managed listing search GIN and trigram indexes", () => {
    const expectedIndexes = [
      {
        name: "Listing_title_trgm_active_idx",
        create:
          /CREATE INDEX(?: CONCURRENTLY)? IF NOT EXISTS "Listing_title_trgm_active_idx"[\s\S]*ON "Listing" USING GIN \("title" gin_trgm_ops\)[\s\S]*WHERE "status" = 'ACTIVE' AND "isPrivate" = false/,
      },
      {
        name: "Listing_tags_gin_idx",
        create:
          /CREATE INDEX(?: CONCURRENTLY)? IF NOT EXISTS "Listing_tags_gin_idx"[\s\S]*ON "Listing" USING GIN \("tags"\)/,
      },
      {
        name: "Listing_description_trgm_active_idx",
        create:
          /CREATE INDEX(?: CONCURRENTLY)? IF NOT EXISTS "Listing_description_trgm_active_idx"[\s\S]*ON "Listing" USING GIN \("description" gin_trgm_ops\)[\s\S]*WHERE "status" = 'ACTIVE' AND "isPrivate" = false/,
      },
    ];

    for (const expected of expectedIndexes) {
      const events = [];
      for (const { name, sql } of migrationFiles()) {
        if (new RegExp(`DROP INDEX[\\s\\S]*"${expected.name}"`).test(sql)) {
          events.push({ name, type: "drop" });
        }
        if (expected.create.test(sql)) {
          events.push({ name, type: "create" });
        }
      }

      assert.equal(events.at(-1)?.type, "create", `${expected.name} should not be dropped after its final create`);
    }
  });

  it("protects raw-managed seller display-name trigram indexes", () => {
    const expectedIndexes = [
      {
        name: "SellerProfile_displayName_trgm_idx",
        create:
          /CREATE INDEX(?: CONCURRENTLY)? IF NOT EXISTS "SellerProfile_displayName_trgm_idx"[\s\S]*ON "SellerProfile" USING GIN \("displayName" gin_trgm_ops\)/,
      },
      {
        name: "SellerProfile_displayNameNormalized_trgm_idx",
        create:
          /CREATE INDEX(?: CONCURRENTLY)? IF NOT EXISTS "SellerProfile_displayNameNormalized_trgm_idx"[\s\S]*ON "SellerProfile" USING GIN \("displayNameNormalized" gin_trgm_ops\)/,
      },
    ];

    for (const expected of expectedIndexes) {
      const events = [];
      for (const { name, sql } of migrationFiles()) {
        if (new RegExp(`DROP INDEX[\\s\\S]*"${expected.name}"`).test(sql)) {
          events.push({ name, type: "drop" });
        }
        if (expected.create.test(sql)) {
          events.push({ name, type: "create" });
        }
      }

      assert.equal(events.at(-1)?.type, "create", `${expected.name} should not be dropped after its final create`);
    }
  });

  it("validates listing check constraints after the NOT VALID migration", () => {
    const migration = source(
      "prisma/migrations/20260521154500_schema_drift_and_raw_index_followups/migration.sql",
    );

    assert.match(migration, /VALIDATE CONSTRAINT "Listing_priceCents_positive_chk"/);
    assert.match(migration, /VALIDATE CONSTRAINT "Listing_stockQuantity_non_negative_chk"/);
  });

  it("keeps Notification.dedupKey default aligned between schema and migration", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source(
      "prisma/migrations/20260521154500_schema_drift_and_raw_index_followups/migration.sql",
    );

    assert.match(
      schema,
      /dedupKey\s+String\s+@default\(dbgenerated\("md5\(random\(\)::text \|\| clock_timestamp\(\)::text\)"\)\)\s+@db\.VarChar\(64\)/,
    );
    assert.match(
      migration,
      /ALTER COLUMN "dedupKey" SET DEFAULT md5\(random\(\)::text \|\| clock_timestamp\(\)::text\)/,
    );
  });
});
