#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);
const REVIEWED_ADVISORY_EXCEPTIONS_BY_SOURCE = Object.freeze({
  "1240992": Object.freeze({
    ghsa: "GHSA-vfj7-8cjw-p6xm",
    scope: "dev-only",
    expiresAt: "2026-11-21T00:00:00.000Z",
    packages: Object.freeze([
      "@next/eslint-plugin-next",
      "braces",
      "eslint-config-next",
      "fast-glob",
      "micromatch",
    ]),
  }),
});
const REVIEWED_ADVISORY_EXCEPTIONS_BY_GHSA = Object.freeze({
  "GHSA-FC5Q-39XC-VJPF": Object.freeze({
    ghsa: "GHSA-fc5q-39xc-vjpf",
    scope: "build/lint-time transitive",
    expiresAt: "2026-11-24T00:00:00.000Z",
    packages: Object.freeze([
      "@next/eslint-plugin-next",
      "@rollup/plugin-commonjs",
      "@rollup/pluginutils",
      "@sentry/nextjs",
      "@typescript-eslint/typescript-estree",
      "eslint-config-next",
      "eslint-import-resolver-typescript",
      "fdir",
      "fast-glob",
      "micromatch",
      "picomatch",
      "tinyglobby",
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

function blockingAdvisoryEvidence(report, packageName, visited = new Set()) {
  if (visited.has(packageName)) return [];
  const vulnerability = report.vulnerabilities?.[packageName];
  if (!vulnerability) return [];
  const nextVisited = new Set(visited).add(packageName);
  const evidence = [];
  for (const entry of vulnerability.via ?? []) {
    if (typeof entry === "string") {
      evidence.push(...blockingAdvisoryEvidence(
        report,
        entry,
        nextVisited,
      ));
    } else if (
      entry
      && BLOCKING_SEVERITIES.has(entry.severity)
    ) {
      const source = Number.isSafeInteger(entry.source)
        ? String(entry.source)
        : null;
      const ghsa = typeof entry.url === "string"
        ? entry.url.match(/\/advisories\/(GHSA-[0-9a-z-]+)(?:$|[/?#])/iu)?.[1]?.toUpperCase()
        : undefined;
      evidence.push(Object.freeze({ source, ghsa: ghsa ?? null }));
    }
  }
  return [...new Map(evidence.map((item) => [
    `${item.source ?? ""}:${item.ghsa ?? ""}`,
    item,
  ])).values()];
}

function reviewedExceptionForAdvisory(advisory, packageName, now) {
  const sourceException = advisory.source
    ? REVIEWED_ADVISORY_EXCEPTIONS_BY_SOURCE[advisory.source]
    : undefined;
  const ghsaException = advisory.ghsa
    ? REVIEWED_ADVISORY_EXCEPTIONS_BY_GHSA[advisory.ghsa]
    : undefined;
  if (sourceException && ghsaException && sourceException !== ghsaException) {
    return null;
  }
  const exception = sourceException ?? ghsaException;
  if (
    !exception
    || !exception.packages.includes(packageName)
    || now >= new Date(exception.expiresAt)
  ) {
    return null;
  }
  return exception;
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
    const evidence = blockingAdvisoryEvidence(report, packageName);
    const exceptions = evidence.map((advisory) =>
      reviewedExceptionForAdvisory(advisory, packageName, now));
    if (evidence.length > 0 && exceptions.every(Boolean)) {
      excepted.push(Object.freeze({
        packageName,
        exceptions: Object.freeze([...new Map(exceptions.map((exception) => [
          exception.ghsa,
          Object.freeze({
            ghsa: exception.ghsa,
            scope: exception.scope,
            expiresAt: exception.expiresAt,
          }),
        ])).values()]),
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
  const production = partitionFullBlockingEntries(productionReport);
  if (production.blocking.length > 0) {
    throw new Error(
      `Production dependency audit failed: ${production.blocking.map(([name]) => name).join(", ")}`,
    );
  }

  const fullReport = runAudit();
  const full = partitionFullBlockingEntries(fullReport);
  if (full.blocking.length > 0) {
    throw new Error(
      `Full dependency audit failed: ${full.blocking.map(([name]) => name).join(", ")}`,
    );
  }
  const exceptions = new Map();
  for (const entry of [...production.excepted, ...full.excepted]) {
    for (const exception of entry.exceptions) {
      exceptions.set(`${exception.ghsa}:${entry.packageName}`, {
        ...exception,
        packageName: entry.packageName,
      });
    }
  }
  if (exceptions.size > 0) {
    const groups = new Map();
    for (const exception of exceptions.values()) {
      const key = `${exception.ghsa}:${exception.scope}:${exception.expiresAt}`;
      const group = groups.get(key) ?? { ...exception, packages: [] };
      group.packages.push(exception.packageName);
      groups.set(key, group);
    }
    for (const exception of groups.values()) {
      console.warn(
        `Temporary ${exception.scope} exception ${exception.ghsa} is active through ${exception.expiresAt} for: ${exception.packages.sort().join(", ")}`,
      );
    }
  }

  console.log("Production dependency audit: no high or critical vulnerabilities.");
  console.log("Full dependency audit: no unreviewed high or critical vulnerabilities.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
