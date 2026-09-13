import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseClawbackClockProofConfig, clawbackClockProofBundle } from "../scripts/order-label-clawback-clock-postgres-proof.mjs";

test("clock proof accepts only its isolated loopback CI database and role", () => {
  const parse = (value) => parseClawbackClockProofConfig({ ORDER_LABEL_CLAWBACK_CLOCK_PROOF_DATABASE_URL: value });
  assert.equal(parse("postgresql://ci:not-a-secret@127.0.0.1:5432/grainline_ci").databaseUrl,
    "postgresql://ci:not-a-secret@127.0.0.1:5432/grainline_ci");
  for (const url of [undefined, "postgresql://ci:x@remote.example/grainline_ci",
    "postgresql://owner:x@localhost/grainline_ci", "postgresql://ci:x@localhost/production",
    "postgresql://ci:x@localhost/grainline_ci?host=remote", "postgresql://ci:x@localhost:5433/grainline_ci",
    "postgresql://ci:x@localhost/grainline_ci#override", "postgresql://ci:x@localhost/grainline_ci?sslmode=disable&options=x"]) {
    assert.throws(() => parse(url));
  }
});
test("clock proof attests exactly one body in the existing rollback-only catalog harness", () => {
  const bundle = clawbackClockProofBundle();
  assert.equal(bundle.length, 1);
  assert.equal(bundle[0].definitions.length, 1);
  assert.equal(bundle[0].definitions[0].name, "grainline_order_label_clawback_claim_batch");
  assert.doesNotMatch(bundle[0].payload, /^COMMIT;$/m);
  assert.match(bundle[0].payload, /before authority drifted/);
  assert.match(bundle[0].payload, /after authority drifted/);
  const source = readFileSync("scripts/order-label-clawback-clock-postgres-proof.mjs", "utf8");
  assert.equal(source.match(/await proveOrderZeroDirectCompatiblePrefixPostgres/g)?.length, 2);
  assert.match(source, /proveInputDraftTransaction\(client, clawbackClockProofBundle\(\), onPhase\)/);
  assert.match(source, /finally \{ await client\.end\(\); \}/);
  assert.match(source, /assert\.equal\(identity\.login, "ci"\)/);
  assert.match(source, /proofServerHostAccepted/);
  assert.match(readFileSync(".github/workflows/ci.yml", "utf8"), /run: node scripts\/order-label-clawback-clock-postgres-proof\.mjs/);
});
