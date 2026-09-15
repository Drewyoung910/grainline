import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseCaseLifecycleProofConfig, caseLifecycleProofPayload } from "../scripts/case-lifecycle-correction-postgres-proof.mjs";

test("Case lifecycle proof refuses production, owner and override targets", () => {
  const parse = (url) => parseCaseLifecycleProofConfig({ CASE_LIFECYCLE_CORRECTION_PROOF_DATABASE_URL: url });
  assert.ok(parse("postgresql://ci:disposable@127.0.0.1:5432/grainline_ci"));
  for (const value of [undefined, "postgresql://ci:x@production.example/grainline_ci",
    "postgresql://owner:x@localhost/grainline_ci", "postgresql://ci:x@localhost/production",
    "postgresql://ci:x@localhost/grainline_ci?host=remote", "postgresql://ci:x@localhost:5433/grainline_ci",
    "postgresql://ci:x@localhost/grainline_ci#override"]) assert.throws(() => parse(value));
});
test("Case draft proof retains exact historical checks and always rolls back", () => {
  const payload = caseLifecycleProofPayload();
  assert.doesNotMatch(payload, /^COMMIT;$/m);
  const source = readFileSync("scripts/case-lifecycle-correction-postgres-proof.mjs", "utf8");
  assert.match(source, /finally \{\s*await client\.query\("ROLLBACK"\)/);
  assert.match(source, /finally \{ await client\.end\(\); \}/);
  assert.match(source, /assert\.equal\(identity\.login, "ci"\)/);
  assert.equal(source.match(/await proveOrderZeroDirectCompatiblePrefixPostgres/g)?.length, 2);
  assert.match(source, /await runCaseLifecycleScenario\(client, scenario\)/);
  assert.match(readFileSync(".github/workflows/ci.yml", "utf8"), /run: node scripts\/case-lifecycle-correction-postgres-proof\.mjs/);
});
