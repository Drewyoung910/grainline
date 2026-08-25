#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION =
  "20260825010000_prepare_blocked_checkout_refund_delivery";
export const BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION_SHA256 =
  "5578678b745d41b57ec658a2363dea15728914c1b82e063bae1e3aea9ebbe25c";

const SOURCE_MIGRATION =
  "prisma/migrations/20260722051500_prepare_notification_rls/migration.sql";
const SOURCE_MIGRATION_SHA256 =
  "9f7eeaf23e0f334dbb52427d27343674a5d11095b0b7f433d3ca177e3914956e";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function extractFunction(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error("blocked-checkout notification source function is missing");
  }
  return source.slice(startIndex, endIndex + end.length);
}

function extractFunctionBody(definition, delimiter) {
  const marker = `AS ${delimiter}`;
  const startIndex = definition.indexOf(marker);
  const endIndex = definition.lastIndexOf(`${delimiter};`);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error("blocked-checkout notification function body is missing");
  }
  return definition.slice(startIndex + marker.length, endIndex);
}

function readPinnedNotificationSource(rootDirectory) {
  const source = fs.readFileSync(
    path.join(rootDirectory, SOURCE_MIGRATION),
    "utf8",
  );
  if (sha256(source) !== SOURCE_MIGRATION_SHA256) {
    throw new Error("blocked-checkout notification source migration drifted");
  }
  return source;
}

function replaceOnce(source, before, after) {
  const first = source.indexOf(before);
  if (first < 0 || first !== source.lastIndexOf(before)) {
    throw new Error("blocked-checkout notification predicate did not match exactly once");
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function buildBlockedCheckoutRefundDeliveryMigration(
  rootDirectory = process.cwd(),
) {
  const source = readPinnedNotificationSource(rootDirectory);

  let notificationCore = extractFunction(
    source,
    "CREATE OR REPLACE FUNCTION public.grainline_notification_create_core(",
    "$grainline_notification_create_core$;",
  );
  notificationCore = replaceOnce(
    notificationCore,
    `          AND p_related_user_id IS NULL
          AND p_type = 'NEW_ORDER'::public."NotificationType")`,
    `          AND p_related_user_id IS NULL
          -- Compatibility window: predecessor deployments still emit
          -- NEW_ORDER; the corrected application emits REFUND_ISSUED.
          AND p_type IN (
            'NEW_ORDER'::public."NotificationType",
            'REFUND_ISSUED'::public."NotificationType"
          ))`,
  );

  return `-- Compatibility-safe correction for automatic blocked-checkout refund
-- delivery. This does not change Notification or OrderPaymentEvent RLS posture,
-- table grants, or any provider state. The predecessor NEW_ORDER spelling stays
-- accepted only through the deployment drain; a later byte-pinned retirement
-- removes it after the corrected application is proven live.

${notificationCore}

REVOKE ALL ON FUNCTION public.grainline_notification_create_core(
  text, text, public."NotificationType", text, text, text
) FROM PUBLIC, grainline_app_runtime;

DO $grainline_blocked_checkout_refund_delivery_verify$
DECLARE
  core_function oid := pg_catalog.to_regprocedure(
    'public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)'
  );
  order_wrapper oid := pg_catalog.to_regprocedure(
    'public.grainline_notification_create_order_event(text,text,public."NotificationType",text,text,text)'
  );
  function_definition text;
BEGIN
  IF core_function IS NULL OR order_wrapper IS NULL THEN
    RAISE EXCEPTION 'Blocked-checkout refund delivery function catalog is incomplete';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(core_function)
    INTO function_definition;
  IF pg_catalog.strpos(
       function_definition,
       'NEW_ORDER''::public."NotificationType",'
     ) = 0
     OR pg_catalog.strpos(
       function_definition,
       'REFUND_ISSUED''::public."NotificationType"'
     ) = 0 THEN
    RAISE EXCEPTION 'Blocked-checkout refund compatibility predicate drifted';
  END IF;

  IF pg_catalog.has_function_privilege(
       'grainline_app_runtime', core_function, 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS routine,
              LATERAL pg_catalog.aclexplode(
                COALESCE(
                  routine.proacl,
                  pg_catalog.acldefault('f', routine.proowner)
                )
              ) AS acl
        WHERE routine.oid = core_function
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime', order_wrapper, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Blocked-checkout refund delivery function grants drifted';
  END IF;
END;
$grainline_blocked_checkout_refund_delivery_verify$;
`;
}

export function blockedCheckoutRefundDeliveryFunctionSources(
  rootDirectory = process.cwd(),
) {
  const source = readPinnedNotificationSource(rootDirectory);
  const predecessorCoreDefinition = extractFunction(
    source,
    "CREATE OR REPLACE FUNCTION public.grainline_notification_create_core(",
    "$grainline_notification_create_core$;",
  );
  const candidateCoreDefinition = extractFunction(
    buildBlockedCheckoutRefundDeliveryMigration(rootDirectory),
    "CREATE OR REPLACE FUNCTION public.grainline_notification_create_core(",
    "$grainline_notification_create_core$;",
  );
  const orderWrapperDefinition = extractFunction(
    source,
    "CREATE OR REPLACE FUNCTION public.grainline_notification_create_order_event(",
    "$grainline_notification_create_order_event$;",
  );
  return Object.freeze({
    predecessorCore: extractFunctionBody(
      predecessorCoreDefinition,
      "$grainline_notification_create_core$",
    ),
    candidateCore: extractFunctionBody(
      candidateCoreDefinition,
      "$grainline_notification_create_core$",
    ),
    orderWrapper: extractFunctionBody(
      orderWrapperDefinition,
      "$grainline_notification_create_order_event$",
    ),
  });
}

export function verifyBlockedCheckoutRefundDeliveryMigrationBytes(
  rootDirectory = process.cwd(),
) {
  const migrationPath = path.join(
    rootDirectory,
    "prisma/migrations",
    BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION,
    "migration.sql",
  );
  const expected = buildBlockedCheckoutRefundDeliveryMigration(rootDirectory);
  if (!fs.existsSync(migrationPath)) {
    throw new Error("blocked-checkout refund delivery migration is missing");
  }
  const migration = fs.readFileSync(migrationPath, "utf8");
  if (migration !== expected) {
    throw new Error("blocked-checkout refund delivery migration bytes drifted");
  }
  if (sha256(migration) !== BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION_SHA256) {
    throw new Error("blocked-checkout refund delivery migration checksum drifted");
  }
  return Object.freeze({
    migrationPath,
    migrationSha256: BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION_SHA256,
  });
}

function main() {
  const rootDirectory = process.cwd();
  const outputPath = path.join(
    rootDirectory,
    "prisma/migrations",
    BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION,
    "migration.sql",
  );
  const expected = buildBlockedCheckoutRefundDeliveryMigration(rootDirectory);
  if (process.argv.includes("--write")) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, expected, "utf8");
  } else if (process.argv.includes("--verify")) {
    verifyBlockedCheckoutRefundDeliveryMigrationBytes(rootDirectory);
  } else {
    process.stdout.write(`${sha256(expected)}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
