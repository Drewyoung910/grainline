import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";

const { requiredProductionEnv } = await import("../src/lib/env.ts");

describe("production env validation", () => {
  it("throws for missing production env vars and stays permissive in local tests", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousVercelEnv = process.env.VERCEL_ENV;
    const previousValue = process.env.GRAINLINE_REQUIRED_ENV_TEST;

    try {
      delete process.env.GRAINLINE_REQUIRED_ENV_TEST;
      process.env.NODE_ENV = "production";
      delete process.env.VERCEL_ENV;
      assert.throws(
        () => requiredProductionEnv("GRAINLINE_REQUIRED_ENV_TEST"),
        /GRAINLINE_REQUIRED_ENV_TEST env var is required in production/,
      );

      process.env.NODE_ENV = "test";
      assert.equal(requiredProductionEnv("GRAINLINE_REQUIRED_ENV_TEST"), "");

      process.env.VERCEL_ENV = "production";
      assert.throws(
        () => requiredProductionEnv("GRAINLINE_REQUIRED_ENV_TEST"),
        /GRAINLINE_REQUIRED_ENV_TEST env var is required in production/,
      );

      process.env.GRAINLINE_REQUIRED_ENV_TEST = " configured ";
      assert.equal(requiredProductionEnv("GRAINLINE_REQUIRED_ENV_TEST"), " configured ");
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = previousVercelEnv;
      if (previousValue === undefined) delete process.env.GRAINLINE_REQUIRED_ENV_TEST;
      else process.env.GRAINLINE_REQUIRED_ENV_TEST = previousValue;
    }
  });

  it("keeps remaining runtime and seed env lookups explicit instead of non-null assertions", () => {
    const providers = readFileSync(new URL("../src/components/Providers.tsx", import.meta.url), "utf8");
    const metroSeed = readFileSync(new URL("../prisma/seeds/metros.ts", import.meta.url), "utf8");

    assert.match(providers, /resolveClerkPublishableKey/);
    assert.match(providers, /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY env var is required in production/);
    assert.doesNotMatch(providers, /process\.env\.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!/);

    assert.match(metroSeed, /requiredSeedEnv\("DATABASE_URL"\)/);
    assert.doesNotMatch(metroSeed, /process\.env\.DATABASE_URL!/);
  });

  it("does not use non-null assertions on named process.env variables", () => {
    const offenders = [];
    for (const file of sourceFiles(["src", "prisma"])) {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      if (/process\.env\.[A-Z0-9_]+!/.test(text)) offenders.push(file);
    }

    assert.deepEqual(offenders, []);
  });
});

function sourceFiles(roots) {
  const files = [];
  const allowed = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

  for (const root of roots) {
    walk(root);
  }

  return files;

  function walk(relativePath) {
    const absolute = new URL(`../${relativePath}`, import.meta.url);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolute)) {
        if (entry === "node_modules" || entry === ".next") continue;
        walk(`${relativePath}/${entry}`);
      }
      return;
    }
    if (allowed.has(relativePath.slice(relativePath.lastIndexOf(".")))) {
      files.push(relativePath);
    }
  }
}
