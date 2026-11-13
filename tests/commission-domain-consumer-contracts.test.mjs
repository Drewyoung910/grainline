import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("..", import.meta.url).pathname);
const sourceRoot = resolve(root, "src");
const operations = [
  "count",
  "create",
  "delete",
  "deleteMany",
  "findFirst",
  "findMany",
  "findUnique",
  "update",
  "updateMany",
];

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const absolute = resolve(directory, entry);
    if (statSync(absolute).isDirectory()) files.push(...sourceFiles(absolute));
    else if (/\.(?:ts|tsx)$/u.test(entry)) files.push(absolute);
  }
  return files;
}

test("Commission application source has zero direct base-table access", () => {
  const delegatePattern = new RegExp(
    `\\bcommission(?:Request|Interest)\\s*\\.\\s*(?:${operations.join("|")})\\s*\\(`,
    "gu",
  );
  const rawSqlPattern =
    /\b(?:FROM|JOIN|UPDATE|INTO|DELETE\s+FROM)\s+(?:public\.)?"Commission(?:Request|Interest)"/giu;
  const direct = [];
  for (const absolute of sourceFiles(sourceRoot)) {
    const source = readFileSync(absolute, "utf8");
    if (delegatePattern.test(source) || rawSqlPattern.test(source)) {
      direct.push(relative(root, absolute).replaceAll("\\", "/"));
    }
    delegatePattern.lastIndex = 0;
    rawSqlPattern.lastIndex = 0;
  }
  assert.deepEqual(direct.sort(), []);
});
