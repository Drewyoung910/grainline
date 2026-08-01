#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);
const REVIEWED_BRACE_EXPANSION_BACKPORT = Object.freeze({
  advisoryId: "GHSA-mh99-v99m-4gvg",
  expiresAt: "2026-08-29T00:00:00.000Z",
  integrity:
    "sha512-w+aeW/mkgM4PyRMOJCgi3fOrTm5Q8QY1OSfn2TO2iuDj3ezIHqejmuxbjfPrqUkgqRew1iqkyAn0tr0ZwHD9+w==",
  lockPath: "node_modules/minimatch/node_modules/brace-expansion",
  resolved:
    "https://registry.npmjs.org/brace-expansion/-/brace-expansion-1.1.17.tgz",
  version: "1.1.17",
});
const REVIEWED_DEV_ONLY_ADVISORIES = new Map([
  [
    REVIEWED_BRACE_EXPANSION_BACKPORT.advisoryId,
    "npm advisory metadata has not yet recognized the official bounded 1.1.17 backport required by ESLint minimatch@3",
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

function assertReviewedBraceExpansionBackport() {
  const expiresAt = Date.parse(REVIEWED_BRACE_EXPANSION_BACKPORT.expiresAt);
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
    throw new Error(
      `Reviewed brace-expansion exception expired at ${REVIEWED_BRACE_EXPANSION_BACKPORT.expiresAt}`,
    );
  }

  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const locked =
    lock.packages?.[REVIEWED_BRACE_EXPANSION_BACKPORT.lockPath];
  for (const field of ["version", "resolved", "integrity"]) {
    if (
      locked?.[field]
      !== REVIEWED_BRACE_EXPANSION_BACKPORT[field]
    ) {
      throw new Error(
        `Reviewed brace-expansion ${field} drifted from the exact 1.1.17 backport`,
      );
    }
  }
  if (!locked.dev) {
    throw new Error(
      "Reviewed brace-expansion backport is no longer development-only",
    );
  }

  const installPath = path.resolve(
    REVIEWED_BRACE_EXPANSION_BACKPORT.lockPath,
  );
  const installedPackage = JSON.parse(
    readFileSync(path.join(installPath, "package.json"), "utf8"),
  );
  if (
    installedPackage.name !== "brace-expansion"
    || installedPackage.version
      !== REVIEWED_BRACE_EXPANSION_BACKPORT.version
  ) {
    throw new Error(
      "Installed brace-expansion does not match the exact reviewed 1.1.17 backport",
    );
  }

  const installedSource = readFileSync(
    path.join(installPath, "index.js"),
    "utf8",
  );
  for (const marker of [
    "EXPANSION_MAX_LENGTH = 4000000",
    "options.maxLength == null ? EXPANSION_MAX_LENGTH",
    "length + expansion.length > maxLength",
    "CVE-2026-14257",
  ]) {
    if (!installedSource.includes(marker)) {
      throw new Error(
        `Reviewed brace-expansion bound marker is absent: ${marker}`,
      );
    }
  }

  const require = createRequire(import.meta.url);
  const expand = require(installPath);
  const bounded = expand("{aa,bb}{cc,dd}", { maxLength: 10 });
  if (
    JSON.stringify(bounded)
    !== JSON.stringify(["aacc", "aadd"])
  ) {
    throw new Error(
      "Reviewed brace-expansion maxLength behavior is not active",
    );
  }
}

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

assertReviewedBraceExpansionBackport();

console.log("Production dependency audit: no high or critical vulnerabilities.");
if (accepted.size === 0) {
  console.log("Full dependency audit: no high or critical vulnerabilities.");
} else {
  for (const [id, rationale] of accepted) {
    console.log(`Reviewed development-only advisory: ${id} (${rationale}).`);
  }
}
