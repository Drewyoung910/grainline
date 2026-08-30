#!/usr/bin/env node
// Prove that tracked application code reaches OrderPaymentEvent only through
// reviewed fixed database operations. Database posture is a later boundary;
// this verifier owns the application-side zero-direct-access claim.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const AUTHORITY_MODULE = "src/lib/orderPaymentEventReadAuthority.ts";
export const EXPECTED_AUTHORITY_CONSUMERS = Object.freeze([
  "src/app/account/orders/page.tsx",
  "src/app/admin/orders/[id]/page.tsx",
  "src/app/api/account/export/route.ts",
  "src/app/dashboard/orders/[id]/page.tsx",
  "src/app/dashboard/orders/page.tsx",
  "src/app/dashboard/sales/[orderId]/page.tsx",
  "src/app/dashboard/sales/page.tsx",
]);
export const EXPECTED_REFERENCE_FILES = Object.freeze([
  ...EXPECTED_AUTHORITY_CONSUMERS,
  "src/app/api/reviews/route.ts",
  "src/lib/localRefundEvidenceCore.ts",
  "src/lib/orderPaymentEventLabels.ts",
  AUTHORITY_MODULE,
  "src/lib/refundRouteState.ts",
].sort());
export const EXPECTED_FIXED_OPERATIONS = Object.freeze([
  "grainline_order_payment_buyer_refund_outcomes",
  "grainline_order_payment_seller_refund_outcomes",
  "grainline_order_payment_buyer_export_page",
  "grainline_order_payment_seller_export_page",
  "grainline_order_payment_staff_timeline",
]);

const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const FORBIDDEN_ACCESS_PATTERNS = Object.freeze([
  Object.freeze({
    label: "Prisma delegate property",
    pattern: /\.\s*orderPaymentEvent\b/,
  }),
  Object.freeze({
    label: "computed Prisma delegate property",
    pattern: /\[\s*["']orderPaymentEvent["']\s*\]/,
  }),
  Object.freeze({
    label: "raw OrderPaymentEvent relation",
    pattern: /(?:public\s*\.\s*)?["']OrderPaymentEvent["']/,
  }),
  Object.freeze({
    label: "unquoted OrderPaymentEvent SQL relation",
    pattern: /\b(?:from|join|into|update|delete\s+from)\s+(?:public\s*\.\s*)?OrderPaymentEvent\b/i,
  }),
  Object.freeze({
    label: "Prisma Order.paymentEvents relation selection",
    pattern: /\bpaymentEvents\s*:\s*(?:true|\{)/,
  }),
  Object.freeze({
    label: "computed Prisma Order.paymentEvents relation selection",
    pattern: /\[\s*["']paymentEvents["']\s*\]/,
  }),
  Object.freeze({
    label: "destructured Prisma delegate",
    pattern: /\{[^}]*\borderPaymentEvent\b[^}]*\}\s*=\s*(?:db|prisma|tx|client)\b/,
  }),
]);

function trackedSourcePaths(rootDirectory) {
  const raw = execFileSync("git", ["ls-files", "-z", "--", "src"], {
    cwd: rootDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return raw.split("\0").filter(Boolean).filter(
    (file) => SOURCE_EXTENSIONS.has(path.extname(file)),
  );
}

export function inspectOrderPaymentEventSource(
  records,
  { scannedFiles = records?.length } = {},
) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("OrderPaymentEvent source inventory is empty");
  }
  if (!Number.isSafeInteger(scannedFiles) || scannedFiles < records.length) {
    throw new Error("OrderPaymentEvent scanned source count drifted");
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
    ) throw new Error("OrderPaymentEvent source inventory shape drifted");

    if (record.source.includes("@/lib/orderPaymentEventReadAuthority")) {
      authorityConsumers.push(record.path);
    }
    if (/OrderPaymentEvent|orderPaymentEvent|paymentEvents/.test(record.source)) {
      referenceFiles.push(record.path);
    }
    for (const check of FORBIDDEN_ACCESS_PATTERNS) {
      if (check.pattern.test(record.source)) {
        directAccess.push(Object.freeze({ label: check.label, path: record.path }));
      }
    }
  }

  const consumers = [...new Set(authorityConsumers)].sort();
  if (JSON.stringify(consumers) !== JSON.stringify([...EXPECTED_AUTHORITY_CONSUMERS].sort())) {
    throw new Error("OrderPaymentEvent fixed-authority consumer inventory drifted");
  }
  if (directAccess.length !== 0) {
    throw new Error(`OrderPaymentEvent direct application access remains in ${directAccess[0].path}`);
  }
  const references = [...new Set(referenceFiles)].sort();
  if (JSON.stringify(references) !== JSON.stringify([...EXPECTED_REFERENCE_FILES].sort())) {
    throw new Error("OrderPaymentEvent tracked source reference inventory drifted");
  }

  const authority = records.find((record) => record.path === AUTHORITY_MODULE)?.source;
  if (
    typeof authority !== "string"
    || EXPECTED_FIXED_OPERATIONS.some((operation) => !authority.includes(operation))
  ) throw new Error("OrderPaymentEvent fixed-authority module drifted");

  return Object.freeze({
    authorityConsumers: Object.freeze(consumers),
    directAccessMatches: 0,
    fixedOperations: EXPECTED_FIXED_OPERATIONS,
    referenceFiles: Object.freeze(references),
    scannedFiles,
  });
}

export function verifyOrderPaymentEventZeroDirectAccess(rootDirectory = process.cwd()) {
  const files = trackedSourcePaths(rootDirectory);
  return inspectOrderPaymentEventSource(files.map((file) => ({
    path: file,
    source: readFileSync(path.join(rootDirectory, file), "utf8"),
  })), { scannedFiles: files.length });
}

export function verifyOrderPaymentEventZeroDirectAccessAtCommit(
  commit,
  rootDirectory = process.cwd(),
) {
  if (!/^(?:HEAD|[a-f0-9]{40})$/.test(commit)) {
    throw new Error("OrderPaymentEvent source commit is invalid");
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
    [
      "grep", "-I", "-l", "-z",
      "-e", "OrderPaymentEvent", "-e", "orderPaymentEvent", "-e", "paymentEvents",
      commit, "--", "src",
    ],
    { cwd: rootDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (grep.error || grep.status !== 0) {
    throw new Error("OrderPaymentEvent committed source reference inventory is unavailable");
  }
  const prefix = `${commit}:`;
  const referenceFiles = grep.stdout.split("\0").filter(Boolean).map((entry) => {
    if (!entry.startsWith(prefix)) {
      throw new Error("OrderPaymentEvent committed source path shape drifted");
    }
    return entry.slice(prefix.length);
  });
  const sourceSet = new Set(allFiles);
  if (referenceFiles.some((file) => !sourceSet.has(file))) {
    throw new Error("OrderPaymentEvent committed source inventory escaped src");
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
    ...inspectOrderPaymentEventSource(records, { scannedFiles: allFiles.length }),
  });
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    const result = verifyOrderPaymentEventZeroDirectAccess();
    console.log(JSON.stringify({ orderPaymentEventZeroDirectAccess: "passed", ...result }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
