#!/usr/bin/env node
// Prove that tracked application code reaches SellerPayoutEvent only through
// the reviewed fixed-operation authority module. This is deliberately static:
// it closes the predecessor application boundary before direct table grants
// are revoked, while the later PostgreSQL proof owns database enforcement.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const AUTHORITY_MODULE = "src/lib/sellerPayoutEventAuthority.ts";
export const EXPECTED_AUTHORITY_CONSUMERS = Object.freeze([
  "src/app/api/account/export/route.ts",
  "src/app/dashboard/seller/page.tsx",
  "src/lib/stripePayoutWebhook.ts",
]);
export const EXPECTED_REFERENCE_FILES = Object.freeze([
  "src/app/api/account/export/route.ts",
  "src/app/dashboard/seller/page.tsx",
  "src/lib/accountExportPayload.ts",
  "src/lib/sellerPayoutEventAuthority.ts",
  "src/lib/sellerPayoutEventState.ts",
  "src/lib/stripePayoutWebhook.ts",
]);

const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const FORBIDDEN_ACCESS_PATTERNS = Object.freeze([
  Object.freeze({
    label: "Prisma delegate property",
    pattern: /\.\s*sellerPayoutEvent\b/,
  }),
  Object.freeze({
    label: "computed Prisma delegate property",
    pattern: /\[\s*["']sellerPayoutEvent["']\s*\]/,
  }),
  Object.freeze({
    label: "raw SellerPayoutEvent relation",
    pattern: /(?:public\s*\.\s*)?["']SellerPayoutEvent["']/,
  }),
]);

function trackedSourcePaths(rootDirectory) {
  const raw = execFileSync("git", ["ls-files", "-z", "--", "src"], {
    cwd: rootDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return raw.split("\0").filter(Boolean).filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)));
}

export function inspectSellerPayoutEventSource(records, { scannedFiles = records?.length } = {}) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("SellerPayoutEvent source inventory is empty");
  }
  if (!Number.isSafeInteger(scannedFiles) || scannedFiles < records.length) {
    throw new Error("SellerPayoutEvent scanned source count drifted");
  }
  const directAccess = [];
  const authorityConsumers = [];
  const referenceFiles = [];
  for (const record of records) {
    if (
      !record
      || typeof record.path !== "string"
      || !record.path.startsWith("src/")
      || typeof record.source !== "string"
    ) throw new Error("SellerPayoutEvent source inventory shape drifted");

    if (record.source.includes("@/lib/sellerPayoutEventAuthority")) {
      authorityConsumers.push(record.path);
    }
    if (/sellerPayoutEvent/i.test(record.source)) referenceFiles.push(record.path);
    for (const check of FORBIDDEN_ACCESS_PATTERNS) {
      if (check.pattern.test(record.source)) {
        directAccess.push(Object.freeze({ label: check.label, path: record.path }));
      }
    }
  }

  const consumers = [...new Set(authorityConsumers)].sort();
  const expected = [...EXPECTED_AUTHORITY_CONSUMERS].sort();
  if (JSON.stringify(consumers) !== JSON.stringify(expected)) {
    throw new Error("SellerPayoutEvent fixed-authority consumer inventory drifted");
  }
  if (directAccess.length !== 0) {
    throw new Error(`SellerPayoutEvent direct application access remains in ${directAccess[0].path}`);
  }
  const references = [...new Set(referenceFiles)].sort();
  const expectedReferences = [...EXPECTED_REFERENCE_FILES].sort();
  if (JSON.stringify(references) !== JSON.stringify(expectedReferences)) {
    throw new Error("SellerPayoutEvent tracked source reference inventory drifted");
  }
  const authority = records.find((record) => record.path === AUTHORITY_MODULE)?.source;
  if (
    typeof authority !== "string"
    || !authority.includes("grainline_seller_payout_event_apply")
    || !authority.includes("grainline_seller_payout_latest_failure")
    || !authority.includes("grainline_seller_payout_export_page")
  ) throw new Error("SellerPayoutEvent fixed-authority module drifted");

  return Object.freeze({
    authorityConsumers: Object.freeze(consumers),
    directAccessMatches: 0,
    referenceFiles: Object.freeze(references),
    scannedFiles,
  });
}

export function verifySellerPayoutEventZeroDirectAccess(rootDirectory = process.cwd()) {
  const records = trackedSourcePaths(rootDirectory).map((file) => ({
    path: file,
    source: readFileSync(path.join(rootDirectory, file), "utf8"),
  }));
  return inspectSellerPayoutEventSource(records);
}

export function verifySellerPayoutEventZeroDirectAccessAtCommit(
  commit,
  rootDirectory = process.cwd(),
) {
  if (!/^(?:HEAD|[a-f0-9]{40})$/.test(commit)) {
    throw new Error("SellerPayoutEvent source commit is invalid");
  }
  const allFiles = execFileSync(
    "git",
    ["ls-tree", "-r", "-z", "--name-only", commit, "--", "src"],
    { cwd: rootDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).split("\0").filter(Boolean).filter(
    (file) => SOURCE_EXTENSIONS.has(path.extname(file)),
  );
  const grep = spawnSync(
    "git",
    ["grep", "-I", "-l", "-z", "-e", "sellerPayoutEvent", "-e", "SellerPayoutEvent", commit, "--", "src"],
    { cwd: rootDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (grep.error || grep.status !== 0) {
    throw new Error("SellerPayoutEvent committed source reference inventory is unavailable");
  }
  const prefix = `${commit}:`;
  const referenceFiles = grep.stdout.split("\0").filter(Boolean).map((entry) => {
    if (!entry.startsWith(prefix)) {
      throw new Error("SellerPayoutEvent committed source path shape drifted");
    }
    return entry.slice(prefix.length);
  });
  const sourceSet = new Set(allFiles);
  if (referenceFiles.some((file) => !sourceSet.has(file))) {
    throw new Error("SellerPayoutEvent committed source inventory escaped src");
  }
  const records = referenceFiles.map((file) => ({
    path: file,
    source: execFileSync("git", ["show", `${commit}:${file}`], {
      cwd: rootDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  }));
  return Object.freeze({
    sourceCommit: commit,
    ...inspectSellerPayoutEventSource(records, { scannedFiles: allFiles.length }),
  });
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    const result = verifySellerPayoutEventZeroDirectAccess();
    console.log(JSON.stringify({ sellerPayoutEventZeroDirectAccess: "passed", ...result }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
