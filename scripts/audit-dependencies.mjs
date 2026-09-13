#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);

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

const productionReport = runAudit(["--omit=dev"]);
const productionBlocking = blockingEntries(productionReport);
if (productionBlocking.length > 0) {
  throw new Error(
    `Production dependency audit failed: ${productionBlocking.map(([name]) => name).join(", ")}`,
  );
}

const fullReport = runAudit();
const fullBlocking = blockingEntries(fullReport);
if (fullBlocking.length > 0) {
  throw new Error(
    `Full dependency audit failed: ${fullBlocking.map(([name]) => name).join(", ")}`,
  );
}

console.log("Production dependency audit: no high or critical vulnerabilities.");
console.log("Full dependency audit: no high or critical vulnerabilities.");
