import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  partitionFullBlockingEntries,
} from "../scripts/audit-dependencies.mjs";

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

    assert.equal(pkg.dependencies?.next, "^16.3.6");
    assert.equal(lock.packages?.["node_modules/next"]?.version, "16.3.6");
    assert.equal(pkg.devDependencies?.["eslint-config-next"], "^16.3.6");
    assert.equal(lock.packages?.["node_modules/eslint-config-next"]?.version, "16.3.6");

    assert.equal(pkg.devDependencies?.postcss, "8.5.23");
    assert.equal(pkg.overrides?.postcss, "8.5.23");
    assert.deepEqual(postcssInstalls, [["node_modules/postcss", "8.5.23"]]);

    assert.equal(pkg.overrides?.["@prisma/dev"], "0.24.16");
    assert.equal(lock.packages?.["node_modules/@prisma/dev"]?.version, "0.24.16");
    assert.equal(pkg.overrides?.browserslist, "4.28.8");
    assert.equal(lock.packages?.["node_modules/browserslist"]?.version, "4.28.8");
    assert.equal(pkg.overrides?.["deepmerge-ts"], "8.0.2");
    assert.equal(lock.packages?.["node_modules/deepmerge-ts"]?.version, "8.0.2");
    assert.equal(pkg.overrides?.browserslist, "4.28.8");
    assert.equal(lock.packages?.["node_modules/browserslist"]?.version, "4.28.8");
    assert.equal(pkg.overrides?.mysql2, "3.24.2");
    assert.equal(lock.packages?.["node_modules/mysql2"]?.version, "3.24.2");
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
    assert.ok(workflow.indexOf("name: Security audit") > workflow.indexOf("run: npm ci --ignore-scripts"));
    assert.ok(workflow.indexOf("name: Security audit") < workflow.indexOf("name: Verify accumulated User access source package"));
    assert.ok(workflow.indexOf("name: Security audit") < workflow.indexOf("name: Tests"));
    assert.match(auditScript, /runAudit\(\["--omit=dev"\]\)/);
    assert.match(auditScript, /Full dependency audit failed/);
    assert.match(auditScript, /GHSA-vfj7-8cjw-p6xm/);
    assert.match(auditScript, /2026-10-17T00:00:00\.000Z/);
    assert.equal(pkg.overrides?.["brace-expansion"], undefined);
    assert.equal(
      lock.packages?.["node_modules/brace-expansion"]?.version,
      "5.0.12",
    );
    assert.equal(
      lock.packages?.["node_modules/minimatch/node_modules/brace-expansion"]?.version,
      "1.1.21",
    );
    assert.equal(
      lock.packages?.["node_modules/fast-uri"]?.version,
      "3.1.7",
    );
    assert.equal(
      lock.packages?.["node_modules/nanoid"]?.version,
      "3.3.18",
    );
    assert.equal(
      lock.packages?.["node_modules/js-yaml"]?.version,
      "4.3.2",
    );
  });

  it("allows only the exact expiring dev-tool advisory chain", () => {
    const report = {
      vulnerabilities: {
        braces: {
          severity: "high",
          via: [{ source: 1240992, severity: "high" }],
        },
        micromatch: { severity: "high", via: ["braces"] },
        "fast-glob": { severity: "high", via: ["micromatch"] },
        "@next/eslint-plugin-next": {
          severity: "high",
          via: ["fast-glob"],
        },
        "eslint-config-next": {
          severity: "high",
          via: ["@next/eslint-plugin-next"],
        },
      },
    };
    const accepted = partitionFullBlockingEntries(
      report,
      new Date("2026-10-03T00:00:00.000Z"),
    );
    assert.equal(accepted.blocking.length, 0);
    assert.deepEqual(
      accepted.excepted.map(({ packageName }) => packageName).sort(),
      [
        "@next/eslint-plugin-next",
        "braces",
        "eslint-config-next",
        "fast-glob",
        "micromatch",
      ],
    );

    const expired = partitionFullBlockingEntries(
      report,
      new Date("2026-10-17T00:00:00.000Z"),
    );
    assert.equal(expired.blocking.length, 5);

    const unrelated = structuredClone(report);
    unrelated.vulnerabilities.remoteParser = {
      severity: "critical",
      via: [{ source: 9999999, severity: "critical" }],
    };
    assert.deepEqual(
      partitionFullBlockingEntries(
        unrelated,
        new Date("2026-10-03T00:00:00.000Z"),
      ).blocking.map(([name]) => name),
      ["remoteParser"],
    );
  });

  it("pins the patched user-content sanitizer", () => {
    const pkg = json("package.json");
    const lock = json("package-lock.json");

    assert.equal(pkg.dependencies?.["sanitize-html"], "^2.17.7");
    assert.equal(lock.packages?.["node_modules/sanitize-html"]?.version, "2.17.7");
  });

  it("keeps every Sharp install on the reviewed patched line", () => {
    const pkg = json("package.json");
    const lock = json("package-lock.json");
    const sharpInstalls = Object.entries(lock.packages ?? {})
      .filter(([path]) => path === "node_modules/sharp" || path.endsWith("/node_modules/sharp"))
      .map(([path, entry]) => [path, entry.version]);

    assert.equal(pkg.devDependencies?.sharp, "^0.35.5");
    assert.equal(pkg.overrides?.sharp, "$sharp");
    assert.equal(lock.packages?.[""]?.devDependencies?.sharp, "^0.35.5");
    assert.deepEqual(sharpInstalls, [["node_modules/sharp", "0.35.5"]]);
    for (const [path, entry] of Object.entries(lock.packages ?? {})) {
      if (path.includes("node_modules/@img/sharp-libvips-")) assert.equal(entry.version, "1.3.4", path);
      else if (path.includes("node_modules/@img/sharp-")) assert.equal(entry.version, "0.35.5", path);
    }
  });

  it("resolves every source-map-js consumer to the reviewed denial-of-service patch", () => {
    const pkg = json("package.json");
    const lock = json("package-lock.json");
    assert.equal(pkg.overrides?.["source-map-js"], "1.2.2");
    const installs = Object.entries(lock.packages ?? {})
      .filter(([path]) => path === "node_modules/source-map-js" || path.endsWith("/node_modules/source-map-js"))
      .map(([path, entry]) => [path, entry.version]);
    assert.deepEqual(installs, [["node_modules/source-map-js", "1.2.2"]]);
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
    assert.equal(pkg.scripts?.build, "prisma generate && node scripts/prepare-maplibre-assets.mjs && next build");
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
