#!/usr/bin/env node
// Exact staged Production application smoke. The private binding is prepared
// only after a READY deployment exists; the operator verifies source, CI,
// deployment URL, and unchanged canonical predecessor before reading bypass
// or provider credentials and before creating a fixture.
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertReleaseBinding,
  readPrivateJson,
  runOperator,
} from "./order-authenticated-route-smoke.mjs";

export function loadStagedReleaseBinding(filePath) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    throw new Error("staged Order smoke requires an absolute private binding path");
  }
  const binding = assertReleaseBinding(readPrivateJson(filePath, "staged Order release binding"));
  if (!binding.targetOrigin) throw new Error("staged Order smoke binding is not staged");
  return binding;
}

export function runStagedOperator() {
  const binding = loadStagedReleaseBinding(process.env.ORDER_AUTH_ROUTE_SMOKE_STAGED_BINDING_FILE);
  return runOperator({ releaseBinding: binding, allowLegacyCleanupRecovery: false });
}

export function stagedFailureMessage(error) {
  const message = error instanceof Error ? error.message : "";
  if (/^(seller fulfillment|buyer receipt) redirect drifted: (status|missing-location|invalid-location|staged-origin|other-origin|canonical-path)$/.test(message)
    || message === "seller note sanitization drifted") return message;
  return "Staged authenticated Order smoke stopped; preserve any private restart journal.";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStagedOperator().catch((error) => {
    console.error(stagedFailureMessage(error));
    process.exitCode = 1;
  });
}
