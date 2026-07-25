import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { extname, join } from "node:path";
import { describe, it } from "node:test";

const EXECUTABLE_SQL_ROOTS = Object.freeze([
  {
    root: "prisma/migrations",
    extensions: new Set([".sql"]),
  },
  {
    root: "docs/rls-drafts",
    extensions: new Set([".sql"]),
  },
  {
    root: "scripts",
    extensions: new Set([".js", ".mjs", ".sql", ".ts"]),
  },
  {
    root: "src",
    extensions: new Set([".js", ".jsx", ".ts", ".tsx"]),
  },
]);

const POSTGRES_SPECIAL_FORM = /\bpg_catalog\s*\.\s*(?:greatest|least|coalesce|nullif|exists|case|current_user|session_user|current_date|current_time|current_timestamp|localtime|localtimestamp)\b/gi;

function sourceFiles(root, extensions) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, extensions);
    return extensions.has(extname(entry.name).toLowerCase()) ? [path] : [];
  });
}

describe("PostgreSQL special-form qualification guardrails", () => {
  it("does not schema-qualify parser-resolved SQL constructs", () => {
    const violations = [];

    for (const { root, extensions } of EXECUTABLE_SQL_ROOTS) {
      for (const file of sourceFiles(root, extensions)) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(POSTGRES_SPECIAL_FORM)) {
          const line = source.slice(0, match.index).split("\n").length;
          violations.push(`${file}:${line}:${match[0]}`);
        }
      }
    }

    assert.deepEqual(violations, []);
  });
});
