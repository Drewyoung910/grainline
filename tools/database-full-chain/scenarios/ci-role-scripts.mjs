import fs from "node:fs";
import path from "node:path";

import { runPsqlScript } from "./psql-script.mjs";

const SCRIPT_CONFIG = Object.freeze([
  Object.freeze({
    file: "provision-runtime-db-role.sql",
    variables: Object.freeze({
      runtime_role: "grainline_app_runtime",
      migration_role: "ci",
    }),
  }),
  Object.freeze({
    file: "provision-direct-upload-cleanup-role.sql",
    variables: Object.freeze({
      cleanup_role: "grainline_direct_upload_cleanup_v2",
      runtime_role: "grainline_app_runtime",
      migration_role: "ci",
    }),
  }),
  Object.freeze({
    file: "provision-order-staff-read-role.sql",
    variables: Object.freeze({
      staff_role: "grainline_staff_read_runtime",
      runtime_role: "grainline_app_runtime",
      migration_role: "ci",
    }),
  }),
]);

async function runScript(adapter, repositoryRoot, file, variables, log) {
  const source = fs.readFileSync(path.join(repositoryRoot, "scripts", file), "utf8");
  const result = await runPsqlScript(adapter, source, variables, { log });
  await adapter.resetOwner();
  return result;
}

async function grantExistingStaffFunctions(adapter, repositoryRoot) {
  const source = fs.readFileSync(
    path.join(repositoryRoot, "scripts", "provision-order-staff-read-role.sql"),
    "utf8",
  );
  const pattern =
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+([\s\S]*?)\s+TO\s+:"staff_role"\s*;/giu;
  const granted = [];
  for (const match of source.matchAll(pattern)) {
    const signatures = match[1].split(/,\s*(?=public\.)/u).map((value) => value.trim());
    for (const signature of signatures) {
      const result = await adapter.query(
        "SELECT pg_catalog.to_regprocedure($1) IS NOT NULL AS present",
        [signature],
      );
      const row = Array.isArray(result) ? result.at(-1)?.rows?.[0] : result.rows?.[0];
      if (row?.present !== true && row?.present !== "t") continue;
      await adapter.query(
        `GRANT EXECUTE ON FUNCTION ${signature} TO grainline_staff_read_runtime`,
      );
      granted.push(signature);
    }
  }
  return granted;
}

export function createCiRoleScriptCallbacks({ log = () => {} } = {}) {
  const attempts = [];
  return Object.freeze({
    attempts,
    bootstrapRoles: async (adapter, repositoryRoot) => {
      const result = await runScript(
        adapter,
        repositoryRoot,
        "prepare-ci-rls-runtime-role.sql",
        {},
        log,
      );
      attempts.push({ phase: "bootstrap", file: "prepare-ci-rls-runtime-role.sql", result });
    },
    convergeRoles: async (adapter, repositoryRoot, context) => {
      const finalFailures = [];
      for (const { file, variables } of SCRIPT_CONFIG) {
        try {
          const result = await runScript(adapter, repositoryRoot, file, variables, log);
          attempts.push({ phase: "converge", file, migration: context.migration, result });
        } catch (error) {
          await adapter.resetOwner();
          const refusal = {
            phase: "converge",
            file,
            migration: context.migration,
            error: `[${error.code ?? "unknown"}] ${error.message}`,
          };
          attempts.push(refusal);
          log(`${file} refused at ${context.migration ?? "final convergence"}: ${refusal.error}`);
          if (file === "provision-order-staff-read-role.sql") {
            refusal.grantedExistingFunctions = await grantExistingStaffFunctions(
              adapter,
              repositoryRoot,
            );
          }
          if (context.migration === null) finalFailures.push(error);
        }
      }
      if (finalFailures.length) {
        throw new AggregateError(
          finalFailures,
          "final disposable role convergence did not complete cleanly",
        );
      }
    },
  });
}
