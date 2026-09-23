#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { PRODUCTION_ORIGIN, runOperator } from "./order-authenticated-route-smoke.mjs";

// Current production application as read back on September 23. If a new
// application is promoted, review and repin before executing the smoke.
// This binding does not assert incident closure or authorize production writes.
export const SUCCESSOR_RELEASE_BINDING = Object.freeze({
  commit: "c2db186049a2239c7b2bd69b7dff1a5a1e247667",
  ciRunId: 35662393815,
  deploymentId: "dpl_25vtLCWQonogcTEBaGh6PqxR5Azk",
  origin: PRODUCTION_ORIGIN,
});

export function runSuccessorOperator() {
  return runOperator({ releaseBinding: SUCCESSOR_RELEASE_BINDING, allowLegacyCleanupRecovery: false });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSuccessorOperator().catch(() => {
    console.error("Authenticated Order successor smoke stopped; preserve any private restart journal.");
    process.exitCode = 1;
  });
}
