#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);
const REVIEWED_DEV_ONLY_ADVISORIES = new Map([
  [
    "GHSA-mh99-v99m-4gvg",
    "brace-expansion denial of service; current ESLint minimatch@3 consumers require the CommonJS v1 API",
  ],
]);
const REVIEWED_DEV_ONLY_PACKAGES = new Set([
  "@eslint/config-array",
  "@eslint/eslintrc",
  "brace-expansion",
  "eslint",
  "eslint-config-next",
  "eslint-plugin-import",
  "eslint-plugin-jsx-a11y",
  "eslint-plugin-react",
  "minimatch",
]);

function runAudit(extraArgs = []) {
  const result = spawnSync("npm", ["audit", "--json", ...extraArgs], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `npm audit did not return valid JSON (exit ${result.status ?? "unknown"}): ${result.stderr.trim()}`,
    );
  }

  if (result.status !== 0 && !report.vulnerabilities) {
    throw new Error(
      `npm audit failed without a vulnerability report (exit ${result.status}): ${result.stderr.trim()}`,
    );
  }

  return report;
}

function blockingEntries(report) {
  return Object.entries(report.vulnerabilities ?? {}).filter(([, vulnerability]) =>
    BLOCKING_SEVERITIES.has(vulnerability.severity),
  );
}

function advisoryIdsFor(report, packageName, seen = new Set()) {
  if (seen.has(packageName)) {
    return new Set();
  }
  seen.add(packageName);

  const vulnerability = report.vulnerabilities?.[packageName];
  if (!vulnerability) {
    return new Set([`unresolved:${packageName}`]);
  }

  const ids = new Set();
  for (const via of vulnerability.via ?? []) {
    if (typeof via === "string") {
      for (const id of advisoryIdsFor(report, via, new Set(seen))) {
        ids.add(id);
      }
      continue;
    }

    const id = typeof via.url === "string" ? via.url.split("/").pop() : undefined;
    ids.add(id || `source:${String(via.source ?? "unknown")}`);
  }
  return ids;
}

const productionReport = runAudit(["--omit=dev"]);
const productionBlocking = blockingEntries(productionReport);
if (productionBlocking.length > 0) {
  throw new Error(
    `Production dependency audit failed: ${productionBlocking.map(([name]) => name).join(", ")}`,
  );
}

const fullReport = runAudit();
const unreviewed = [];
const accepted = new Map();

for (const [packageName] of blockingEntries(fullReport)) {
  const advisoryIds = advisoryIdsFor(fullReport, packageName);
  const unknownIds = [...advisoryIds].filter((id) => !REVIEWED_DEV_ONLY_ADVISORIES.has(id));
  if (
    !REVIEWED_DEV_ONLY_PACKAGES.has(packageName) ||
    unknownIds.length > 0 ||
    advisoryIds.size === 0
  ) {
    unreviewed.push(`${packageName} (${[...advisoryIds].join(", ") || "no advisory id"})`);
    continue;
  }

  for (const id of advisoryIds) {
    accepted.set(id, REVIEWED_DEV_ONLY_ADVISORIES.get(id));
  }
}

if (unreviewed.length > 0) {
  throw new Error(`Unreviewed high/critical dependency advisories: ${unreviewed.join("; ")}`);
}

console.log("Production dependency audit: no high or critical vulnerabilities.");
if (accepted.size === 0) {
  console.log("Full dependency audit: no high or critical vulnerabilities.");
} else {
  for (const [id, rationale] of accepted) {
    console.log(`Reviewed development-only advisory: ${id} (${rationale}).`);
  }
}
