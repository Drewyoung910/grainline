import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

function sourceFiles(root) {
  const files = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.push(path);
    }
  }

  return files;
}

describe("Vercel function region guardrails", () => {
  it("keeps the project-wide function region close to the Neon database", () => {
    const config = JSON.parse(source("vercel.json"));
    assert.deepEqual(config.regions, ["sfo1"]);
  });

  it("keeps every route on the reviewed project-wide region", () => {
    const routeRegionOverride = /\bpreferredRegion\s*=/;
    const offenders = sourceFiles("src/app").filter((path) => routeRegionOverride.test(source(path)));

    assert.deepEqual(offenders, [], `route-level region overrides: ${offenders.join(", ")}`);
  });
});
