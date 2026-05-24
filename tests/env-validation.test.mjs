import assert from "node:assert/strict";
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
});
