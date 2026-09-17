#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { PRODUCTION_ORIGIN, runOperator } from "./order-authenticated-route-smoke.mjs";

// Accepted Clerk application, not the dormant Order application candidate.
// This exact source/CI/deployment was accepted on September 15. If credential
// recovery deploys another application, review and repin before execution.
// Nothing here asserts incident closure or authorizes a production smoke.
export const SUCCESSOR_RELEASE_BINDING = Object.freeze({
  commit: "f2bf570b4759ee41bc18f8d353abc25a0b339a6d",
  ciRunId: 34926985573,
  deploymentId: "dpl_316SCJK2AtaGPsSVQ5rTK42qC8oD",
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
