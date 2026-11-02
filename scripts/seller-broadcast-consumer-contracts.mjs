import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SOURCE_ROOT = resolve(ROOT, "src");

const OPERATIONS = Object.freeze([
  "count",
  "create",
  "delete",
  "deleteMany",
  "findFirst",
  "findMany",
  "findUnique",
  "update",
  "updateMany",
]);

const EXPECTED_DIRECT_CALLERS = Object.freeze({});

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

export function sellerBroadcastConsumerInventory() {
  const directCallers = {};
  const rawSqlCallers = [];
  const operationPattern = new RegExp(
    `\\bsellerBroadcast\\s*\\.\\s*(${OPERATIONS.join("|")})\\s*\\(`,
    "g",
  );
  const rawSqlPattern =
    /\b(?:FROM|JOIN|UPDATE|INTO|DELETE\s+FROM)\s+(?:public\.)?"SellerBroadcast"/gi;

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

export function assertSellerBroadcastConsumerContracts() {
  const inventory = sellerBroadcastConsumerInventory();
  const expectedFiles = sorted(Object.keys(EXPECTED_DIRECT_CALLERS));
  const actualFiles = sorted(Object.keys(inventory.directCallers));
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `SellerBroadcast direct caller drift: expected ${JSON.stringify(expectedFiles)}, got ${JSON.stringify(actualFiles)}`,
    );
  }
  for (const file of expectedFiles) {
    const expected = sorted(EXPECTED_DIRECT_CALLERS[file]);
    const actual = inventory.directCallers[file];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `SellerBroadcast operation drift in ${file}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  }
  if (inventory.rawSqlCallers.length > 0) {
    throw new Error(
      `Unclassified direct SellerBroadcast SQL callers: ${inventory.rawSqlCallers.join(", ")}`,
    );
  }
  return inventory;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inventory = assertSellerBroadcastConsumerContracts();
  const operationCount = Object.values(inventory.directCallers).reduce(
    (count, operations) => count + operations.length,
    0,
  );
  process.stdout.write(
    `${JSON.stringify({
      model: "SellerBroadcast",
      files: Object.keys(inventory.directCallers).length,
      operations: operationCount,
      rawSqlCallers: inventory.rawSqlCallers.length,
    })}\n`,
  );
}
