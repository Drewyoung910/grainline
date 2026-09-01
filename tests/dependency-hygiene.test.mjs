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

  it("keeps reviewed security patches resolved without splitting core package lines", () => {
    const pkg = json("package.json");
    const lock = json("package-lock.json");
    const postcssInstalls = Object.entries(lock.packages ?? {})
      .filter(([path]) => path === "node_modules/postcss" || path.endsWith("/node_modules/postcss"))
      .map(([path, entry]) => [path, entry.version]);

    assert.equal(pkg.dependencies?.next, "^16.2.12");
    assert.equal(lock.packages?.["node_modules/next"]?.version, "16.2.12");
    assert.equal(pkg.devDependencies?.["eslint-config-next"], "^16.2.12");
    assert.equal(lock.packages?.["node_modules/eslint-config-next"]?.version, "16.2.12");

    assert.equal(pkg.devDependencies?.postcss, "8.5.23");
    assert.equal(pkg.overrides?.postcss, "8.5.23");
    assert.deepEqual(postcssInstalls, [["node_modules/postcss", "8.5.23"]]);

    assert.equal(pkg.overrides?.["@prisma/dev"], "0.24.16");
    assert.equal(lock.packages?.["node_modules/@prisma/dev"]?.version, "0.24.16");
    assert.equal(pkg.overrides?.browserslist, "4.28.8");
    assert.equal(lock.packages?.["node_modules/browserslist"]?.version, "4.28.8");
    assert.equal(pkg.overrides?.["deepmerge-ts"], "8.0.2");
    assert.equal(lock.packages?.["node_modules/deepmerge-ts"]?.version, "8.0.2");
    assert.equal(lock.packages?.["node_modules/find-my-way"]?.version, "9.7.0");
    assert.equal(pkg.overrides?.mysql2, "3.24.2");
    assert.equal(lock.packages?.["node_modules/mysql2"]?.version, "3.24.2");
    assert.equal(pkg.overrides?.valibot, "1.4.2");
    assert.equal(lock.packages?.["node_modules/valibot"]?.version, "1.4.2");
  });

  it("keeps every high or critical dependency advisory fail-closed", () => {
    const pkg = json("package.json");
    const lock = json("package-lock.json");
    const workflow = source(".github/workflows/ci.yml");
    const auditScript = source("scripts/audit-dependencies.mjs");

    assert.equal(pkg.scripts?.["audit:dependencies"], "node scripts/audit-dependencies.mjs");
    assert.match(workflow, /npm run audit:dependencies/);
    assert.match(auditScript, /runAudit\(\["--omit=dev"\]\)/);
    assert.match(auditScript, /Full dependency audit failed/);
    assert.doesNotMatch(auditScript, /REVIEWED_DEV_ONLY/);
    assert.equal(pkg.overrides?.["brace-expansion"], undefined);
    assert.equal(
      lock.packages?.["node_modules/brace-expansion"]?.version,
      "5.0.9",
    );
    assert.equal(
      lock.packages?.["node_modules/minimatch/node_modules/brace-expansion"]?.version,
      "1.1.18",
    );
    assert.equal(
      lock.packages?.["node_modules/fast-uri"]?.version,
      "3.1.5",
    );
    assert.equal(
      lock.packages?.["node_modules/nanoid"]?.version,
      "3.3.18",
    );
    assert.equal(
      lock.packages?.["node_modules/js-yaml"]?.version,
      "4.3.1",
    );
  });

  it("pins the patched user-content sanitizer", () => {
    const pkg = json("package.json");
    const lock = json("package-lock.json");

    assert.equal(pkg.dependencies?.["sanitize-html"], "^2.17.6");
    assert.equal(lock.packages?.["node_modules/sanitize-html"]?.version, "2.17.6");
  });

  it("keeps every Sharp install on the reviewed patched line", () => {
    const pkg = json("package.json");
    const lock = json("package-lock.json");
    const sharpInstalls = Object.entries(lock.packages ?? {})
      .filter(([path]) => path === "node_modules/sharp" || path.endsWith("/node_modules/sharp"))
      .map(([path, entry]) => [path, entry.version]);

    assert.equal(pkg.devDependencies?.sharp, "^0.35.3");
    assert.equal(pkg.overrides?.sharp, "$sharp");
    assert.equal(lock.packages?.[""]?.devDependencies?.sharp, "^0.35.3");
    assert.deepEqual(sharpInstalls, [["node_modules/sharp", "0.35.3"]]);
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
