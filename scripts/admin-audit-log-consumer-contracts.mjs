import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SOURCE_ROOT = resolve(ROOT, "src");

const OPERATIONS = Object.freeze([
  "aggregate",
  "count",
  "create",
  "createMany",
  "delete",
  "deleteMany",
  "findFirst",
  "findMany",
  "findUnique",
  "groupBy",
  "update",
  "updateMany",
  "upsert",
]);

// Baseline at isolated serial head 2a10b3d354e766ef787249f790a19b4d3a92212b.
// Compatible preparation must drive this object and rawSqlCallers to empty.
const EXPECTED_DIRECT_CALLERS = Object.freeze({
  "src/lib/accountDeletion.ts": ["create", "findMany"],
  "src/lib/accountDeletionSideEffects.ts": ["update"],
  "src/lib/audit.ts": ["create", "findMany", "findUnique", "updateMany"],
});

const EXPECTED_RAW_SQL_CALLERS = Object.freeze([
  "src/lib/accountDeletion.ts",
]);

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const absolute = resolve(directory, entry);
    if (statSync(absolute).isDirectory()) {
      files.push(...sourceFiles(absolute));
    } else if (/\.(?:ts|tsx)$/.test(entry)) {
      files.push(absolute);
    }
  }
  return files;
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function adminAuditLogConsumerInventory() {
  const directCallers = {};
  const rawSqlCallers = [];
  const operationPattern = new RegExp(
    `\\badminAuditLog\\s*\\.\\s*(${OPERATIONS.join("|")})\\s*\\(`,
    "g",
  );
  const rawSqlPattern =
    /\b(?:FROM|JOIN|UPDATE|INTO|DELETE\s+FROM)\s+(?:public\.)?"AdminAuditLog"/gi;

  for (const absolute of sourceFiles(SOURCE_ROOT)) {
    const file = relative(ROOT, absolute).replaceAll("\\", "/");
    const source = readFileSync(absolute, "utf8");
    const operations = [...source.matchAll(operationPattern)].map(
      (match) => match[1],
    );
    if (operations.length > 0) directCallers[file] = sorted(operations);
    if (rawSqlPattern.test(source)) rawSqlCallers.push(file);
  }

  return Object.freeze({
    directCallers: Object.freeze(directCallers),
    rawSqlCallers: Object.freeze(sorted(rawSqlCallers)),
  });
}

export function assertAdminAuditLogConsumerContracts() {
  const inventory = adminAuditLogConsumerInventory();
  const expectedFiles = sorted(Object.keys(EXPECTED_DIRECT_CALLERS));
  const actualFiles = sorted(Object.keys(inventory.directCallers));
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `AdminAuditLog direct caller drift: expected ${JSON.stringify(expectedFiles)}, got ${JSON.stringify(actualFiles)}`,
    );
  }
  for (const file of expectedFiles) {
    const expected = sorted(EXPECTED_DIRECT_CALLERS[file]);
    const actual = inventory.directCallers[file];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `AdminAuditLog operation drift in ${file}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  }
  if (JSON.stringify(inventory.rawSqlCallers) !== JSON.stringify(EXPECTED_RAW_SQL_CALLERS)) {
    throw new Error(
      `AdminAuditLog raw SQL caller drift: expected ${JSON.stringify(EXPECTED_RAW_SQL_CALLERS)}, got ${JSON.stringify(inventory.rawSqlCallers)}`,
    );
  }
  return inventory;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inventory = assertAdminAuditLogConsumerContracts();
  const operationCount = Object.values(inventory.directCallers).reduce(
    (count, operations) => count + operations.length,
    0,
  ) + inventory.rawSqlCallers.length;
  process.stdout.write(
    `${JSON.stringify({
      model: "AdminAuditLog",
      files: new Set([
        ...Object.keys(inventory.directCallers),
        ...inventory.rawSqlCallers,
      ]).size,
      operations: operationCount,
      rawSqlCallers: inventory.rawSqlCallers.length,
    })}\n`,
  );
}
