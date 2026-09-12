import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadStockUpdate, parseStockProofConfig, verifyStockProofIdentity } from "../scripts/listing-stock-mutation-postgres-proof.mjs";

test("native stock proof rejects non-disposable targets and unexpected identities", () => {
  const key = "LISTING_STOCK_MUTATION_PROOF_DATABASE_URL";
  const accepted = "postgresql://ci:synthetic@localhost:5432/grainline_ci";
  assert.deepEqual(parseStockProofConfig({ [key]: accepted }), { databaseUrl: accepted });
  for (const url of [undefined, accepted.replace("localhost", "production.example"),
    accepted.replace("grainline_ci", "neondb"), accepted.replace("ci:", "neondb_owner:"),
    accepted.replace("5432", "5433"), `${accepted}?options=-csearch_path%3Dpublic`, `${accepted}#override`]) {
    assert.throws(() => parseStockProofConfig({ [key]: url }));
  }
  const identity = { db: "grainline_ci", actor: "ci", login: "ci", host: "127.0.0.1", version: 160004 };
  verifyStockProofIdentity(identity);
  for (const drift of [{ db: "neondb" }, { actor: "grainline_app_runtime" }, { login: "owner" },
    { host: "8.8.8.8" }, { version: 170000 }]) assert.throws(() => verifyStockProofIdentity({ ...identity, ...drift }));
});
test("native proof executes the production tagged UPDATE with bound parameters", async () => {
  let captured;
  const rows = await loadStockUpdate()({ $queryRaw: async (parts, ...values) => {
    captured = { text: parts.join("?"), values }; return [{ stockQuantity: 10 }];
  } }, "listing", { seller: { id: "seller" } }, true, 5, 10);
  assert.equal(rows[0].stockQuantity, 10);
  assert.match(captured.text, /WITH previous_listing AS MATERIALIZED/);
  assert.match(captured.text, /FOR UPDATE/);
  assert.equal(captured.values[0], "listing"); assert.equal(captured.values[1], "seller");
  assert.equal(captured.values.filter((value) => value === true).length, 3);
});
test("concurrency proof is wired only in disposable CI and verifies exact-schema teardown", () => {
  const proof = readFileSync("scripts/listing-stock-mutation-postgres-proof.mjs", "utf8");
  assert.match(proof, /pg_blocking_pids/);
  assert.match(proof, /rollback-and-retry/);
  assert.match(proof, /checkout-before-adjustment/);
  assert.match(proof, /adjustment-before-checkout/);
  assert.match(proof, /independent-adjustments/);
  assert.match(proof, /DROP SCHEMA "\$\{schema\}" CASCADE/);
  assert.match(proof, /SELECT count\(\*\)::int AS n FROM pg_namespace WHERE nspname=\$1/);
  assert.doesNotMatch(proof, /ALTER ROLE|GRANT |REVOKE |prisma migrate/);
  assert.match(readFileSync(".github/workflows/ci.yml", "utf8"), /LISTING_STOCK_MUTATION_PROOF_DATABASE_URL: \$\{\{ env.DIRECT_URL \}\}/);
  assert.doesNotMatch(readFileSync(".github/workflows/production-migrations.yml", "utf8"), /listing-stock-mutation/);
});
