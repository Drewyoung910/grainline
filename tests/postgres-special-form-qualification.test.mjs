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

const POSTGRES_SPECIAL_FORM = /\bpg_catalog\s*\.\s*(?:greatest|least|coalesce|nullif|position|extract|exists|case|current_user|session_user|current_date|current_time|current_timestamp|localtime|localtimestamp)\b/gi;
const QUALIFIED_UNNEST = /\bpg_catalog\s*\.\s*unnest\s*\(/gi;
const QUALIFIED_SUBSTRING = /\bpg_catalog\s*\.\s*substring\s*\(/gi;

function qualifiedSubstringSpecialForms(source) {
  const violations = [];
  for (const match of source.matchAll(QUALIFIED_SUBSTRING)) {
    const open = source.indexOf("(", match.index);
    let parentheses = 1;
    let quote = null;
    let word = "";
    for (let index = open + 1; index < source.length && parentheses > 0; index += 1) {
      const character = source[index];
      const next = source[index + 1];
      if (quote) {
        if (character === quote && next === quote) {
          index += 1;
        } else if (character === quote) {
          quote = null;
        }
        continue;
      }
      if (character === "'" || character === '"') {
        quote = character;
        word = "";
      } else if (character === "(") {
        parentheses += 1;
        word = "";
      } else if (character === ")") {
        if (
          parentheses === 1 &&
          (word.toLowerCase() === "from" || word.toLowerCase() === "for")
        ) {
          violations.push(match.index);
          break;
        }
        parentheses -= 1;
        word = "";
      } else if (parentheses === 1 && /[A-Za-z]/.test(character)) {
        word += character;
      } else {
        if (
          parentheses === 1 &&
          (word.toLowerCase() === "from" || word.toLowerCase() === "for")
        ) {
          violations.push(match.index);
          break;
        }
        word = "";
      }
    }
  }
  return violations;
}

function qualifiedMultiArrayUnnest(source) {
  const violations = [];
  for (const match of source.matchAll(QUALIFIED_UNNEST)) {
    const open = source.indexOf("(", match.index);
    let parentheses = 1;
    let brackets = 0;
    let quote = null;
    for (let index = open + 1; index < source.length && parentheses > 0; index += 1) {
      const character = source[index];
      const next = source[index + 1];
      if (quote) {
        if (character === quote && next === quote) {
          index += 1;
        } else if (character === quote) {
          quote = null;
        }
        continue;
      }
      if (character === "'" || character === '"') {
        quote = character;
      } else if (character === "(") {
        parentheses += 1;
      } else if (character === ")") {
        parentheses -= 1;
      } else if (character === "[") {
        brackets += 1;
      } else if (character === "]") {
        brackets -= 1;
      } else if (character === "," && parentheses === 1 && brackets === 0) {
        violations.push(match.index);
        break;
      }
    }
  }
  return violations;
}

function sourceFiles(root, extensions) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, extensions);
    return extensions.has(extname(entry.name).toLowerCase()) ? [path] : [];
  });
}

describe("PostgreSQL special-form qualification guardrails", () => {
  it("distinguishes callable substring syntax from parser-only forms", () => {
    assert.deepEqual(
      qualifiedSubstringSpecialForms("SELECT pg_catalog.substring(value, 2);"),
      [],
    );
    assert.equal(
      qualifiedSubstringSpecialForms(
        "SELECT pg_catalog.substring(value FROM 2);",
      ).length,
      1,
    );
    assert.equal(
      qualifiedSubstringSpecialForms(
        "SELECT pg_catalog.substring(value FOR 4);",
      ).length,
      1,
    );
  });

  it("does not schema-qualify parser-resolved SQL constructs", () => {
    const violations = [];

    for (const { root, extensions } of EXECUTABLE_SQL_ROOTS) {
      for (const file of sourceFiles(root, extensions)) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(POSTGRES_SPECIAL_FORM)) {
          const line = source.slice(0, match.index).split("\n").length;
          violations.push(`${file}:${line}:${match[0]}`);
        }
        for (const index of qualifiedMultiArrayUnnest(source)) {
          const line = source.slice(0, index).split("\n").length;
          violations.push(`${file}:${line}:qualified multi-array unnest`);
        }
        for (const index of qualifiedSubstringSpecialForms(source)) {
          const line = source.slice(0, index).split("\n").length;
          violations.push(`${file}:${line}:qualified substring special form`);
        }
      }
    }

    assert.deepEqual(violations, []);
  });
});
