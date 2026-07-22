import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const EXPECTED_NOTIFICATION_EMISSION_PATHS = 54;

const FAMILY_SQL_FUNCTION_BY_SOURCE_KEY = {
  BLOG_COMMENT: "grainline_notification_create_source_fanout",
  FOLLOWED_MAKER_NEW_BLOG: "grainline_notification_create_source_fanout",
  FOLLOWED_MAKER_NEW_LISTING: "grainline_notification_create_source_fanout",
  SELLER_BROADCAST: "grainline_notification_create_source_fanout",
  FAVORITE: "grainline_notification_create_social_event",
  FOLLOW: "grainline_notification_create_social_event",
  REVIEW: "grainline_notification_create_social_event",
  MESSAGE: "grainline_notification_create_message_event",
  COMMISSION_INTEREST: "grainline_notification_create_commission_event",
  COMMISSION_REQUEST: "grainline_notification_create_commission_event",
  CASE: "grainline_notification_create_case_event",
  CASE_MESSAGE: "grainline_notification_create_case_event",
  CASE_RESOLUTION_MARK: "grainline_notification_create_case_event",
  CASE_SYSTEM_ACTION: "grainline_notification_create_case_event",
  CHECKOUT_LOW_STOCK: "grainline_notification_create_inventory_event",
  MANUAL_LOW_STOCK: "grainline_notification_create_inventory_event",
  GUILD_ADMIN_ACTION: "grainline_notification_create_verification_event",
  GUILD_SYSTEM_ACTION: "grainline_notification_create_verification_event",
  LISTING_ADMIN_REVIEW: "grainline_notification_create_moderation_event",
  LISTING_USER_REPORT: "grainline_notification_create_moderation_event",
  ADMIN_ACCOUNT_MESSAGE: "grainline_notification_create_account_warning",
  BANNED_SELLER_ORDER: "grainline_notification_create_account_warning",
  ORDER_CHECKOUT: "grainline_notification_create_order_event",
  ORDER_FULFILLMENT: "grainline_notification_create_order_event",
  ORDER_PAYMENT: "grainline_notification_create_order_event",
  STRIPE_PAYOUT_FAILURE: "grainline_notification_create_order_event",
};

function sqlAuthorityExists(authoritySql, functionName) {
  const escapedFunctionName = functionName.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`CREATE OR REPLACE FUNCTION public\\.${escapedFunctionName}\\(`).test(authoritySql)
    && new RegExp(
      `REVOKE ALL ON FUNCTION public\\.${escapedFunctionName}\\([\\s\\S]{0,400}\\)\\s+FROM PUBLIC, grainline_app_runtime;`,
    ).test(authoritySql)
    && new RegExp(
      `GRANT EXECUTE ON FUNCTION public\\.${escapedFunctionName}\\([\\s\\S]{0,400}\\)\\s+TO grainline_app_runtime;`,
    ).test(authoritySql);
}

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

function emissionFromObject(file, sourceFile, object, kind, serviceAccess, authoritySql) {
  const sourceType = objectProperty(object, "sourceType");
  const sourceId = objectProperty(object, "sourceId");
  const sourceTypeText = sourceType && ts.isPropertyAssignment(sourceType)
    ? sourceType.initializer.getText(sourceFile)
    : null;
  const sourceIdText = sourceId && ts.isPropertyAssignment(sourceId)
    ? sourceId.initializer.getText(sourceFile)
    : null;
  const familyKey = sourceTypeText?.match(/^NOTIFICATION_SOURCE_TYPES\.([A-Z0-9_]+)$/)?.[1] ?? null;
  const authorityFunction = familyKey ? FAMILY_SQL_FUNCTION_BY_SOURCE_KEY[familyKey] ?? null : null;
  const hasServiceDispatch = Boolean(
    familyKey
    && authorityFunction
    && serviceAccess.includes(`NOTIFICATION_SOURCE_TYPES.${familyKey}`)
    && serviceAccess.includes(`public.${authorityFunction}(`)
  );
  const hasSqlAuthority = Boolean(
    authorityFunction && sqlAuthorityExists(authoritySql, authorityFunction)
  );
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
    authorityFunction,
    hasServiceDispatch,
    hasSqlAuthority,
    reviewedFamily: hasServiceDispatch && hasSqlAuthority,
  };
}

function backInStockEmission(file, sourceFile, object, serviceAccess, authoritySql) {
  const restockAuditId = objectProperty(object, "restockAuditId");
  const stockNotificationId = objectProperty(object, "stockNotificationId");
  const hasValue = (property) => Boolean(
    property
    && (
      ts.isShorthandPropertyAssignment(property)
      || (ts.isPropertyAssignment(property)
        && !["null", "undefined"].includes(property.initializer.getText(sourceFile)))
    )
  );
  const position = sourceFile.getLineAndCharacterOfPosition(object.getStart(sourceFile));
  const authorityFunction = "grainline_notification_claim_back_in_stock";
  const hasServiceDispatch = serviceAccess.includes(`public.${authorityFunction}(`);
  const hasSqlAuthority = sqlAuthorityExists(authoritySql, authorityFunction);
  return {
    id: `${file}:${position.line + 1}:BACK_IN_STOCK`,
    file,
    line: position.line + 1,
    kind: "back-in-stock-claim",
    type: "BACK_IN_STOCK",
    sourceType: "NOTIFICATION_SOURCE_TYPES.BACK_IN_STOCK",
    hasSourcePair: hasValue(restockAuditId) && hasValue(stockNotificationId),
    authorityFunction,
    hasServiceDispatch,
    hasSqlAuthority,
    reviewedFamily: hasServiceDispatch && hasSqlAuthority,
  };
}

export function collectNotificationEmissionPaths({
  sourceRoot = "src",
  serviceAccessPath = "src/lib/notificationServiceAccess.ts",
  authoritySqlPath = "docs/rls-drafts/notification-service-authority.sql",
} = {}) {
  const serviceAccess = fs.readFileSync(serviceAccessPath, "utf8");
  const authoritySql = fs.readFileSync(authoritySqlPath, "utf8");
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
            emissions.push(emissionFromObject(
              file,
              sourceFile,
              argument,
              "direct",
              serviceAccess,
              authoritySql,
            ));
          } else if (!(file === "src/app/api/orders/[id]/fulfillment/route.ts"
            && argument?.getText(sourceFile) === "payload")) {
            const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            unresolvedCalls.push(`${file}:${position.line + 1}:createNotification`);
          }
        }
        if (node.expression.text === "claimBackInStockNotification") {
          const argument = node.arguments[0];
          if (argument && ts.isObjectLiteralExpression(argument)) {
            emissions.push(backInStockEmission(
              file,
              sourceFile,
              argument,
              serviceAccess,
              authoritySql,
            ));
          } else {
            const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            unresolvedCalls.push(`${file}:${position.line + 1}:claimBackInStockNotification`);
          }
        }
        if (node.expression.text === "notifyBuyer") {
          const payload = node.arguments[2];
          if (file === "src/app/api/orders/[id]/fulfillment/route.ts"
            && payload && ts.isObjectLiteralExpression(payload)) {
            emissions.push(emissionFromObject(
              file,
              sourceFile,
              payload,
              "fulfillment",
              serviceAccess,
              authoritySql,
            ));
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
