import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIRECT_UPLOAD_ACTIVATION_FUNCTION_NAMES,
} from "./direct-upload-activation-catalog.mjs";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function directUploadFunctionSources(rootDir = ROOT_DIR) {
  const migrationsDir = path.join(rootDir, "prisma", "migrations");
  const expectedNames = new Set(DIRECT_UPLOAD_ACTIVATION_FUNCTION_NAMES);
  const sources = new Map();
  for (const entry of readdirSync(migrationsDir, { withFileTypes: true })
    .filter((candidate) => candidate.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const migrationPath = path.join(
      migrationsDir,
      entry.name,
      "migration.sql",
    );
    if (!existsSync(migrationPath)) continue;
    const sql = readFileSync(migrationPath, "utf8");
    const pattern =
      /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(grainline_direct_upload_[A-Za-z0-9_]+)\s*\([\s\S]*?\nAS\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\2;/g;
    for (const match of sql.matchAll(pattern)) {
      if (expectedNames.has(match[1])) {
        sources.set(match[1], match[3]);
      }
    }
  }
  const missing = [...expectedNames]
    .filter((name) => !sources.has(name))
    .sort((left, right) => left.localeCompare(right));
  const unexpected = [...sources]
    .map(([name]) => name)
    .filter((name) => !expectedNames.has(name))
    .sort((left, right) => left.localeCompare(right));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `DirectUpload migration function-source catalog drifted: missing=${missing.join(",") || "none"} unexpected=${unexpected.join(",") || "none"}`,
    );
  }
  return Object.freeze(
    Object.fromEntries(
      [...sources]
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

export function directUploadFunctionSourceHashes(rootDir = ROOT_DIR) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(directUploadFunctionSources(rootDir))
        .map(([name, source]) => [name, sha256(source)]),
    ),
  );
}
