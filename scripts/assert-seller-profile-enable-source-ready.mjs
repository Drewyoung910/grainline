import path from "node:path";
import { pathToFileURL } from "node:url";

import { auditModelIndirectAccess } from "./audit-user-indirect-access.mjs";

export function assertSellerProfileEnableSourceReady(report) {
  const counts = Object.freeze({
    direct: Number(report.directCount ?? report.direct?.length ?? 0),
    relations: Number(report.relationCount ?? report.relations?.length ?? 0),
    rawSql: Number(report.rawSqlCount ?? report.rawSql?.length ?? 0),
    relationFactories: Number(
      report.factoryRelationCount ?? report.factoryRelations?.length ?? 0,
    ),
    targetOpaquePredicates: Number(
      report.targetOpaquePredicateCount
      ?? report.opaqueShapes?.filter(({ model }) => model === "SellerProfile").length
      ?? 0,
    ),
  });
  if (!Object.values(counts).every(Number.isSafeInteger)) {
    throw new Error("SellerProfile source-readiness inventory is invalid");
  }
  if (Object.values(counts).some((count) => count !== 0)) {
    throw new Error(
      "SellerProfile ENABLE is blocked by residual base-table consumers: "
      + `direct=${counts.direct}; relations=${counts.relations}; `
      + `rawSql=${counts.rawSql}; relationFactories=${counts.relationFactories}; `
      + `targetOpaquePredicates=${counts.targetOpaquePredicates}`,
    );
  }
  return counts;
}

export function inspectSellerProfileEnableSourceReadiness(root = process.cwd()) {
  return assertSellerProfileEnableSourceReady(
    auditModelIndirectAccess(root, "SellerProfile"),
  );
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const counts = inspectSellerProfileEnableSourceReadiness();
    process.stdout.write(`${JSON.stringify({ counts })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
