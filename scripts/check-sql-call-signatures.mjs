#!/usr/bin/env node
// Compares every grainline_* SQL call under src with the signatures the migrations
// leave behind. $queryRaw is untyped, so tsc cannot see a wrong argument count or
// cast, and the page only fails when someone opens it.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const CALL = /\b(?:FROM|SELECT|CALL|JOIN)\s+(?:\*\s+FROM\s+)?(?:public\.)?"?(grainline_[a-z0-9_]+)"?\s*\(/gi;
const CREATE = /CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+(?:public\.)?"?(grainline_[a-z0-9_]+)"?\s*\(/gi;
const DROP = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?((?:(?:public\.)?"?grainline_[a-z0-9_]+"?(?:\s*\([^)]*\))?(?:\s*,\s*)?)+)/gi;
const TYPE_ALIASES = { int: "integer", int4: "integer", int8: "bigint", bool: "boolean", varchar: "text", "character varying": "text", timestamp: "timestamp without time zone", timestamptz: "timestamp with time zone" };

// The comma-separated arguments from just after "(" up to its matching ")".
function readArgs(text, start) {
  const args = [];
  let current = "";
  let depth = 0;
  let quoted = false;
  for (const char of text.slice(start)) {
    if (char === "'") quoted = !quoted;
    if (!quoted && char === ")" && depth === 0) break;
    if (!quoted && "([".includes(char)) depth += 1;
    if (!quoted && ")]".includes(char)) depth -= 1;
    if (char === "," && !depth && !quoted) {
      args.push(current.trim());
      current = "";
    } else current += char;
  }
  return current.trim() ? [...args, current.trim()] : args;
}
const normalizeType = (type) =>
  type.toLowerCase().replace(/"/g, "").replace(/\b(public|pg_catalog)\./g, "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim().replace(/^[a-z0-9_ ]+/, (base) => TYPE_ALIASES[base] ?? base);
function parseParams(args) {
  const types = [];
  let required = 0;
  for (const arg of args) {
    const tokens = arg.replace(/\bDEFAULT\b.*|=.*/is, "").trim().split(/\s+/);
    if (/^OUT$/i.test(tokens[0])) continue;
    if (/^(IN|INOUT|VARIADIC)$/i.test(tokens[0])) tokens.shift();
    const unnamed = tokens.length === 1 || /^(double|character|timestamp|time|bit)$/i.test(tokens[0]);
    types.push(normalizeType((unnamed ? tokens : tokens.slice(1)).join(" ")));
    if (!/\bDEFAULT\b|=/i.test(arg)) required += 1;
  }
  return { types, required };
}

export function migratedSignatures(migrationsDir) {
  const signatures = new Map();
  for (const name of fs.readdirSync(migrationsDir).sort()) {
    const file = path.join(migrationsDir, name, "migration.sql");
    if (!fs.existsSync(file)) continue;
    const sql = fs.readFileSync(file, "utf8").replace(/^\s*--.*$/gm, "");
    for (const match of [...sql.matchAll(CREATE), ...sql.matchAll(DROP)].sort((a, b) => a.index - b.index)) {
      if (/^DROP/i.test(match[0])) {
        for (const item of match[1].matchAll(/"?(grainline_[a-z0-9_]+)"?(?:\s*\(([^)]*)\))?/gi)) {
          if (item[2] === undefined) signatures.delete(item[1]);
          else signatures.get(item[1])?.delete(parseParams(readArgs(`${item[2]})`, 0)).types.join());
        }
      } else {
        const params = parseParams(readArgs(sql, match.index + match[0].length));
        if (!signatures.has(match[1])) signatures.set(match[1], new Map());
        signatures.get(match[1]).set(params.types.join(), params);
      }
    }
  }
  return signatures;
}

export function checkSqlCallSignatures(root, migrationsDir = path.join(root, "prisma/migrations")) {
  const signatures = migratedSignatures(migrationsDir);
  const mismatches = [];
  let calls = 0;
  for (const rel of fs.readdirSync(path.join(root, "src"), { recursive: true })) {
    if (!/\.tsx?$/.test(rel)) continue;
    const file = path.join(root, "src", rel);
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      // Each ${...} in a tagged template becomes one placeholder argument.
      const text = ts.isTemplateExpression(node) ? node.head.text + node.templateSpans.map((span) => `$0${span.literal.text}`).join("") : ts.isStringLiteralLike(node) ? node.text : "";
      for (const match of text.matchAll(CALL)) {
        const args = readArgs(text, match.index + match[0].length);
        const casts = args.map((arg) => arg.match(/::\s*("?[\w. ]+"?(?:\[\])?)$/)?.[1]).map((cast) => cast && normalizeType(cast));
        const known = [...(signatures.get(match[1])?.values() ?? [])];
        calls += 1;
        if (!known.some(({ types, required }) => args.length >= required && args.length <= types.length && casts.every((cast, i) => !cast || cast === types[i]))) {
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          mismatches.push(`src/${rel}:${line} ${match[1]}(${casts.map((cast) => cast ?? "?").join(", ")}) does not match ${known.map(({ types }) => `(${types.join(", ")})`).join(" or ") || "any migrated function"}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { calls, mismatches };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { calls, mismatches } = checkSqlCallSignatures(process.argv[2] ?? process.cwd());
  for (const mismatch of mismatches) console.error(mismatch);
  console.log(`${calls} grainline_* SQL call(s) checked, ${mismatches.length} mismatch(es)`);
  process.exitCode = mismatches.length ? 1 : 0;
}

