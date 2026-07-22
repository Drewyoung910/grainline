import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
const matrix = fs.readFileSync("docs/rls-coverage-matrix.md", "utf8");

function schemaModels() {
  return [...schema.matchAll(/^model\s+([A-Za-z][A-Za-z0-9_]*)\s+\{/gm)]
    .map((match) => match[1])
    .sort();
}

function matrixRows() {
  return [...matrix.matchAll(
    /^\| `([A-Za-z][A-Za-z0-9_]*)` \| `([A-Z_]+)` \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm,
  )].map((match) => ({
    model: match[1],
    status: match[2],
    group: match[3].trim(),
    actors: match[4].trim(),
    nextProof: match[5].trim(),
  }));
}

describe("site-wide RLS coverage matrix", () => {
  it("contains every Prisma model exactly once", () => {
    const models = schemaModels();
    const rows = matrixRows();
    const documentedModels = rows.map((row) => row.model).sort();

    assert.equal(models.length, 58, "review the snapshot count when the schema changes");
    assert.equal(rows.length, models.length, "matrix must have exactly one row per model");
    assert.deepEqual(documentedModels, models);
    assert.equal(new Set(documentedModels).size, documentedModels.length);
  });

  it("uses only explicit incomplete or evidenced disposition states", () => {
    const allowed = new Set([
      "RLS_LIVE_PHASE_A",
      "RLS_LIVE_PHASE_B",
      "PLANNED_RLS",
      "BLOCKED_DESIGN",
      "ALTERNATIVE_REVIEW",
    ]);
    const rows = matrixRows();

    for (const row of rows) {
      assert.ok(allowed.has(row.status), `${row.model} has unknown status ${row.status}`);
      assert.ok(row.group.length > 0, `${row.model} needs an activation owner or group`);
      assert.ok(row.actors.length > 0, `${row.model} needs a data and actor summary`);
      assert.ok(row.nextProof.length > 0, `${row.model} needs a blocking prerequisite or next proof`);
    }
  });

  it("does not overstate current production RLS coverage", () => {
    const liveRows = matrixRows().filter((row) => row.status.startsWith("RLS_LIVE"));
    assert.deepEqual(liveRows.map((row) => row.model), ["SavedSearch"]);
    assert.match(matrix, /Every\s+other row is \*\*not active RLS\*\*/);
    assert.match(matrix, /Application authorization alone is not that\s+alternative\./);
  });

  it("keeps future saved-search alerts outside the sealed Phase B contract", () => {
    assert.match(matrix, /Future Saved-Search Match Alerts/);
    assert.match(matrix, /notifyEmail Boolean @default\(true\)/);
    assert.match(matrix, /no `UPDATE` on `SavedSearch`/);
    assert.match(matrix, /durable unique delivery ledger keyed by saved search and listing/);
    assert.match(matrix, /after Bucket B establishes the Notification\s+service-write model/);
    assert.match(matrix, /should not delay the already sealed SavedSearch Phase B/);
  });
});
