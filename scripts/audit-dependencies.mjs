#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);
const REVIEWED_DEV_ONLY_ADVISORY_EXCEPTIONS = Object.freeze({
  "1240992": Object.freeze({
    ghsa: "GHSA-vfj7-8cjw-p6xm",
    expiresAt: "2026-10-17T00:00:00.000Z",
    packages: Object.freeze([
      "@next/eslint-plugin-next",
      "braces",
      "eslint-config-next",
      "fast-glob",
      "micromatch",
    ]),
  }),
});

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

function blockingAdvisorySources(report, packageName, visited = new Set()) {
  if (visited.has(packageName)) return new Set();
  const vulnerability = report.vulnerabilities?.[packageName];
  if (!vulnerability) return new Set();
  const nextVisited = new Set(visited).add(packageName);
  const sources = new Set();
  for (const entry of vulnerability.via ?? []) {
    if (typeof entry === "string") {
      for (const source of blockingAdvisorySources(
        report,
        entry,
        nextVisited,
      )) sources.add(source);
    } else if (
      entry
      && BLOCKING_SEVERITIES.has(entry.severity)
      && Number.isSafeInteger(entry.source)
    ) {
      sources.add(String(entry.source));
    }
  }
  return sources;
}

export function partitionFullBlockingEntries(
  report,
  now = new Date(),
) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("dependency audit exception clock must be a valid Date");
  }
  const blocking = [];
  const excepted = [];
  for (const entry of blockingEntries(report)) {
    const [packageName] = entry;
    const sources = [...blockingAdvisorySources(report, packageName)].sort();
    const exception = sources.length === 1
      ? REVIEWED_DEV_ONLY_ADVISORY_EXCEPTIONS[sources[0]]
      : undefined;
    if (
      exception
      && exception.packages.includes(packageName)
      && now < new Date(exception.expiresAt)
    ) {
      excepted.push(Object.freeze({
        advisorySource: sources[0],
        ghsa: exception.ghsa,
        packageName,
        expiresAt: exception.expiresAt,
      }));
    } else {
      blocking.push(entry);
    }
  }
  return Object.freeze({
    blocking: Object.freeze(blocking),
    excepted: Object.freeze(excepted),
  });
}

export function main() {
  const productionReport = runAudit(["--omit=dev"]);
  const productionBlocking = blockingEntries(productionReport);
  if (productionBlocking.length > 0) {
    throw new Error(
      `Production dependency audit failed: ${productionBlocking.map(([name]) => name).join(", ")}`,
    );
  }

  const fullReport = runAudit();
  const full = partitionFullBlockingEntries(fullReport);
  if (full.blocking.length > 0) {
    throw new Error(
      `Full dependency audit failed: ${full.blocking.map(([name]) => name).join(", ")}`,
    );
  }
  if (full.excepted.length > 0) {
    const exception = full.excepted[0];
    console.warn(
      `Temporary dev-only exception ${exception.ghsa} is active through ${exception.expiresAt} for: ${full.excepted.map(({ packageName }) => packageName).join(", ")}`,
    );
  }

  console.log("Production dependency audit: no high or critical vulnerabilities.");
  console.log("Full dependency audit: no unreviewed high or critical vulnerabilities.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
