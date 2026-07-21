import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function source(path) {
  return readFileSync(path, "utf8");
}

describe("dependency hygiene guardrails", () => {
  it("keeps TypeScript-only direct packages out of production dependencies", () => {
    const pkg = json("package.json");
    const directDeps = pkg.dependencies ?? {};
    const devDeps = pkg.devDependencies ?? {};

    assert.equal(directDeps["@types/marked"], undefined);
    assert.equal(directDeps["@types/pg"], undefined);
    assert.equal(directDeps["@types/sanitize-html"], undefined);

    assert.equal(devDeps["@types/pg"], "^8.20.0");
    assert.equal(devDeps["@types/sanitize-html"], "^2.16.1");
  });

  it("declares the Node runtime expected by CI and production builds", () => {
    const pkg = json("package.json");
    const lock = json("package-lock.json");

    assert.equal(pkg.engines?.node, ">=22");
    assert.equal(lock.packages?.[""]?.engines?.node, ">=22");
  });

  it("keeps direct Prisma packages on the same minor version", () => {
    const pkg = json("package.json");
    const lock = json("package-lock.json");
    const expected = "^7.9.0";
    const expectedLockVersion = "7.9.0";

    assert.equal(pkg.dependencies?.["@prisma/client"], expected);
    assert.equal(pkg.dependencies?.["@prisma/adapter-pg"], expected);
    assert.equal(pkg.devDependencies?.prisma, expected);

    assert.equal(lock.packages?.["node_modules/@prisma/client"]?.version, expectedLockVersion);
    assert.equal(lock.packages?.["node_modules/@prisma/adapter-pg"]?.version, expectedLockVersion);
    assert.equal(lock.packages?.["node_modules/prisma"]?.version, expectedLockVersion);
  });

  it("does not reintroduce stale marked ambient types", () => {
    const pkg = json("package.json");
    const lock = source("package-lock.json");

    assert.equal(pkg.dependencies?.marked, "^17.0.6");
    assert.equal(pkg.devDependencies?.["@types/marked"], undefined);
    assert.doesNotMatch(lock, /node_modules\/@types\/marked/);
  });

  it("documents the CI and production install-script difference", () => {
    const pkg = json("package.json");
    const workflow = source(".github/workflows/ci.yml");
    const docs = source("CLAUDE.md");

    assert.match(workflow, /npm ci --ignore-scripts/);
    assert.equal(pkg.scripts?.build, "prisma generate && next build");
    assert.match(docs, /CI installs with `npm ci --ignore-scripts`/);
    assert.match(docs, /Vercel production installs use normal npm lifecycle behavior/);
  });

  it("keeps major dependency updates visible for manual review", () => {
    const dependabot = source(".github/dependabot.yml");
    const docs = source("CLAUDE.md");

    assert.doesNotMatch(dependabot, /dependency-name:\s*"\*"/);
    assert.doesNotMatch(dependabot, /version-update:semver-major/);
    assert.match(dependabot, /major-updates:\s*\n\s+update-types:\s*\n\s+- "major"/);
    assert.match(docs, /major version bumps are grouped separately for manual review instead of being ignored/);
  });
});
