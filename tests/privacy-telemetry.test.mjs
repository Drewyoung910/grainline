import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const { hashEmailForTelemetry } = await import("../src/lib/privacyTelemetry.ts");

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function sourceFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

describe("privacy telemetry helpers", () => {
  it("hashes normalized emails for Sentry correlation without exposing the address", () => {
    const first = hashEmailForTelemetry("  Buyer@Example.COM ");
    const second = hashEmailForTelemetry("buyer@example.com");

    assert.equal(first, second);
    assert.match(first, /^sha256:[a-f0-9]{24}$/);
    assert.doesNotMatch(first, /buyer|example/i);
  });

  it("returns null for invalid emails", () => {
    assert.equal(hashEmailForTelemetry(null), null);
    assert.equal(hashEmailForTelemetry("not-an-email"), null);
  });

  it("keeps raw public-form emails out of Sentry extra payloads", () => {
    for (const path of [
      "src/app/api/support/route.ts",
      "src/app/api/legal/data-request/route.ts",
    ]) {
      const source = read(path);
      assert.match(source, /hashEmailForTelemetry\(normalized\.request\.email\)/);
      assert.doesNotMatch(source, /extra:\s*\{[^}]*email:\s*normalized\.request\.email/s);
      assert.doesNotMatch(source, /extra:\s*\{[^}]*normalized\.request\.email/s);
    }
  });

  it("keeps raw suppressed emails out of Sentry extra payloads", () => {
    const source = read("src/lib/emailSuppression.ts");

    assert.match(source, /emailHash:\s*hashEmailForTelemetry\(email\)/);
    assert.doesNotMatch(source, /extra:\s*\{[^}]*email,\s*reason/s);
    assert.doesNotMatch(source, /extra:\s*\{[^}]*email:\s*email/s);
  });

  it("does not select entire User records from Prisma relations", () => {
    for (const file of sourceFiles("src")) {
      const source = read(file);
      assert.doesNotMatch(
        source,
        /\binclude:\s*\{\s*user:\s*true\b/s,
        `${file} must narrow User relation fields instead of include user: true`,
      );
      assert.doesNotMatch(
        source,
        /\bselect:\s*\{\s*user:\s*true\b/s,
        `${file} must narrow User relation fields instead of select user: true`,
      );
    }
  });
});
