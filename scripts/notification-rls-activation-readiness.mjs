import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const EXPECTED_NOTIFICATION_EMISSION_PATHS = 54;

function sourceFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [child] : [];
  });
}

function objectProperty(object, name) {
  return object.properties.find((property) => {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return false;
    return property.name?.getText(object.getSourceFile()).replaceAll(/["']/g, "") === name;
  });
}

function notificationType(object) {
  const property = objectProperty(object, "type");
  if (!property || !ts.isPropertyAssignment(property)) return "unknown";
  return property.initializer.getText(object.getSourceFile()).replaceAll(/["']/g, "");
}

function emissionFromObject(file, sourceFile, object, kind, serviceAccess) {
  const sourceType = objectProperty(object, "sourceType");
  const sourceId = objectProperty(object, "sourceId");
  const sourceTypeText = sourceType && ts.isPropertyAssignment(sourceType)
    ? sourceType.initializer.getText(sourceFile)
    : null;
  const sourceIdText = sourceId && ts.isPropertyAssignment(sourceId)
    ? sourceId.initializer.getText(sourceFile)
    : null;
  const familyKey = sourceTypeText?.match(/^NOTIFICATION_SOURCE_TYPES\.([A-Z0-9_]+)$/)?.[1] ?? null;
  const position = sourceFile.getLineAndCharacterOfPosition(object.getStart(sourceFile));
  return {
    id: `${file}:${position.line + 1}:${notificationType(object)}`,
    file,
    line: position.line + 1,
    kind,
    type: notificationType(object),
    sourceType: sourceTypeText,
    hasSourcePair: Boolean(
      familyKey
      && sourceIdText
      && sourceIdText !== "null"
      && sourceIdText !== "undefined"
    ),
    reviewedFamily: Boolean(familyKey && serviceAccess.includes(`NOTIFICATION_SOURCE_TYPES.${familyKey}`)),
  };
}

export function collectNotificationEmissionPaths({
  sourceRoot = "src",
  serviceAccessPath = "src/lib/notificationServiceAccess.ts",
} = {}) {
  const serviceAccess = fs.readFileSync(serviceAccessPath, "utf8");
  const emissions = [];
  const unresolvedCalls = [];

  for (const file of sourceFiles(sourceRoot)) {
    const text = fs.readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (node.expression.text === "createNotification") {
          const argument = node.arguments[0];
          if (argument && ts.isObjectLiteralExpression(argument)) {
            emissions.push(emissionFromObject(file, sourceFile, argument, "direct", serviceAccess));
          } else if (!(file === "src/app/api/orders/[id]/fulfillment/route.ts"
            && argument?.getText(sourceFile) === "payload")) {
            const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            unresolvedCalls.push(`${file}:${position.line + 1}:createNotification`);
          }
        }
        if (node.expression.text === "notifyBuyer") {
          const payload = node.arguments[2];
          if (file === "src/app/api/orders/[id]/fulfillment/route.ts"
            && payload && ts.isObjectLiteralExpression(payload)) {
            emissions.push(emissionFromObject(file, sourceFile, payload, "fulfillment", serviceAccess));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return { emissions, unresolvedCalls };
}

export function evaluateNotificationActivationReadiness(
  { emissions, unresolvedCalls = [] },
  expectedCount = EXPECTED_NOTIFICATION_EMISSION_PATHS,
) {
  const uncovered = emissions.filter((emission) => !emission.hasSourcePair || !emission.reviewedFamily);
  return {
    ready: emissions.length === expectedCount && uncovered.length === 0 && unresolvedCalls.length === 0,
    expectedCount,
    totalCount: emissions.length,
    coveredCount: emissions.length - uncovered.length,
    uncoveredCount: uncovered.length,
    uncovered,
    unresolvedCalls,
  };
}

export function notificationActivationReadiness(options) {
  return evaluateNotificationActivationReadiness(collectNotificationEmissionPaths(options));
}

function runCli() {
  const result = notificationActivationReadiness();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ready) {
    process.stderr.write(
      `Notification RLS activation blocked: ${result.coveredCount}/${result.expectedCount} emission paths have reviewed source authority.\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
