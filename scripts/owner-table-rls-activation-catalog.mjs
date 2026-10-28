#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { functionSourceFromMigration } from "./private-table-preparation-catalog.mjs";

const RELEASE_ID_PATTERN = /^[a-z][a-z0-9_]{2,63}$/u;

export const OWNER_TABLE_RLS_CONFIRMATION = "activate-reviewed-owner-table-rls";

export const OWNER_TABLE_RLS_ACTIVATIONS = Object.freeze({
  saved_blog_post_v1: Object.freeze({
    minimumCompatibleAppCommit: "e77792ff3bd3a5c540c64db7a6996b75790cb64e",
    predecessorDeploymentId: "dpl_9P14wnz14RfsVfaiALkUhR4eejph",
    predecessorSourceCommit: "18bdcb7e59a435001e8a8c903606ff8b78819249",
    shape: "saved_blog_post",
    migration: "20261023070000_activate_saved_blog_post_rls",
    migrationSha256: "687a254c80e08bb86b605931d8128b0b23b25f7b9904c42c588418b7c69f5b08",
    table: "SavedBlogPost",
    trigger: "grainline_saved_blog_post_insert_guard",
    guardFunction: "grainline_saved_blog_post_insert_guard",
    policies: Object.freeze([
      Object.freeze({ name: "saved_blog_post_owner_delete", command: "d" }),
      Object.freeze({ name: "saved_blog_post_owner_insert", command: "a" }),
      Object.freeze({ name: "saved_blog_post_owner_select", command: "r" }),
    ]),
    retainedFunctionMigration:
      "20261020235800_prepare_seller_profile_owner_saved_blog_posts",
    retainedFunctionMigrationSha256:
      "b55fc240e8a56dd73c1d1b798802e305c5bb63d960552da7bbe1083e4ea48a89",
    retainedFunctions: Object.freeze([
      Object.freeze({
        name: "grainline_seller_owner_saved_blog_post_count",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_seller_owner_saved_blog_post_page",
        arguments: "integer, integer",
      }),
    ]),
  }),
  cart_cart_item_v1: Object.freeze({
    minimumCompatibleAppCommit: "b29e41a5287b5d5f43f54ff29da23210f18001e9",
    predecessorDeploymentId: "dpl_CQzwxpZQzyxn4d9zHJy5o9JMN1Y1",
    predecessorSourceCommit: "a0524648ec37b397d004e9b816eb933f55ab385a",
    shape: "cart_cart_item",
    migration: "20261023080000_activate_cart_cart_item_rls",
    migrationSha256: "4f1349984a06b66ad649d2a3360f9a7498b3162418187f602f0b4949c9a5d6fb",
    tables: Object.freeze(["Cart", "CartItem"]),
    policies: Object.freeze([
      Object.freeze({ table: "Cart", name: "cart_owner_delete", command: "d" }),
      Object.freeze({ table: "Cart", name: "cart_owner_insert", command: "a" }),
      Object.freeze({ table: "Cart", name: "cart_owner_select", command: "r" }),
      Object.freeze({ table: "Cart", name: "cart_owner_update", command: "w" }),
      Object.freeze({ table: "CartItem", name: "cart_item_owner_delete", command: "d" }),
      Object.freeze({ table: "CartItem", name: "cart_item_owner_insert", command: "a" }),
      Object.freeze({ table: "CartItem", name: "cart_item_owner_select", command: "r" }),
      Object.freeze({ table: "CartItem", name: "cart_item_owner_update", command: "w" }),
    ]),
    serviceFunctions: Object.freeze([
      Object.freeze({
        name: "grainline_cart_item_admin_listing_cleanup",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_cart_item_seller_listing_cleanup",
        arguments: "text",
      }),
    ]),
    retainedFunctions: Object.freeze([
      Object.freeze({
        name: "grainline_checkout_reservation_create_cart",
        arguments: "text, text, text, text, text",
        runtimeExecute: false,
      }),
      Object.freeze({
        name: "grainline_checkout_reservation_create_cart_consistent",
        arguments: "text, text, text, text, text, jsonb",
        runtimeExecute: false,
      }),
      Object.freeze({
        name: "grainline_order_seller_analytics_summary",
        arguments: "text, bigint, bigint, boolean",
      }),
      Object.freeze({
        name: "grainline_seller_actor_cart_transaction_states",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_seller_checkout_private_state",
        arguments: "text, text, text, text",
      }),
      Object.freeze({
        name: "grainline_seller_shipping_quote_state",
        arguments: "text, text, text, text",
      }),
      Object.freeze({
        name: "grainline_stripe_checkout_order_create",
        arguments: "text, bigint, text, text, timestamp without time zone, jsonb",
      }),
    ]),
  }),
  stock_notification_v1: Object.freeze({
    minimumCompatibleAppCommit: "e57362b515f41f0f72d7d483dc79a651de6bb711",
    // Replace the placeholder deployment id with the exact reviewed
    // predecessor immediately before this candidate becomes mergeable.
    predecessorDeploymentId: "dpl_REPLACE_BEFORE_MERGE",
    predecessorSourceCommit: "af1ee330f661c4604bf939085b175d00060d2dd0",
    shape: "stock_notification",
    migration: "20261027040000_activate_stock_notification_rls",
    migrationSha256: "e32566d4fa62880598de4ecdc088eebd56d4e97544de2178d51963c21091fcfb",
    table: "StockNotification",
    policies: Object.freeze([
      Object.freeze({
        name: "stock_notification_owner_delete",
        command: "d",
        usingExpression:
          '("userId" = NULLIF(current_setting(\'app.user_id\'::text, true), \'\'::text))',
      }),
      Object.freeze({
        name: "stock_notification_owner_select",
        command: "r",
        usingExpression:
          '("userId" = NULLIF(current_setting(\'app.user_id\'::text, true), \'\'::text))',
      }),
    ]),
    retainedFunctionMigration:
      "20261026010000_prepare_stock_notification_authorities",
    retainedFunctionMigrationSha256:
      "3c77aed31571f7e4adb942bea15611ee97d75e8183f76899cc634749ab2955ce",
    retainedFunctions: Object.freeze([
      Object.freeze({
        name: "grainline_stock_notification_owner_subscribe",
        arguments: "text, text",
      }),
      Object.freeze({
        name: "grainline_stock_notification_seller_counts",
        arguments: "text[]",
      }),
      Object.freeze({
        name: "grainline_stock_notification_seller_range_count",
        arguments:
          "timestamp without time zone, timestamp without time zone, boolean",
      }),
      Object.freeze({
        name: "grainline_stock_notification_restock_candidates",
        arguments: "text, integer",
      }),
      Object.freeze({
        name: "grainline_stock_notification_seller_listing_cleanup",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_stock_notification_admin_listing_cleanup",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_stock_notification_block_cleanup",
        arguments: "text",
      }),
      Object.freeze({
        name: "grainline_stock_notification_owner_export",
        arguments: "",
      }),
      Object.freeze({
        name: "grainline_notification_claim_back_in_stock",
        arguments: "text, text, text",
      }),
    ]),
  }),
});

function stopped(message) {
  return new Error(`owner-table RLS activation stopped: ${message}`);
}

export function ownerTableRlsActivation(releaseId) {
  if (typeof releaseId !== "string" || !RELEASE_ID_PATTERN.test(releaseId)) {
    throw stopped("release id is invalid");
  }
  const release = OWNER_TABLE_RLS_ACTIVATIONS[releaseId];
  if (!release) throw stopped("release id is not reviewed");
  return release;
}

export function verifyOwnerTableRlsPredecessor(
  releaseId,
  deploymentId,
  sourceCommit,
) {
  const release = ownerTableRlsActivation(releaseId);
  if (
    deploymentId !== release.predecessorDeploymentId
    || sourceCommit !== release.predecessorSourceCommit
  ) {
    throw stopped("predecessor deployment binding drifted");
  }
  return release;
}

function migrationArtifact(rootDir, migration, expectedDigest) {
  const migrationPath = path.join(
    rootDir,
    `prisma/migrations/${migration}/migration.sql`,
  );
  const bytes = readFileSync(migrationPath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expectedDigest) throw stopped(`${migration} digest drifted`);
  return Object.freeze({ migrationPath, digest, sql: bytes.toString("utf8") });
}

export function verifyOwnerTableRlsActivationSource(
  releaseId,
  rootDir = process.cwd(),
) {
  const release = ownerTableRlsActivation(releaseId);
  const activation = migrationArtifact(
    rootDir,
    release.migration,
    release.migrationSha256,
  );
  if (release.shape === "cart_cart_item") {
    for (const table of release.tables) {
      const quotedTable = table.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const tablePattern = `public\\."${quotedTable}"`;
      if (
        !new RegExp(`ALTER\\s+TABLE\\s+${tablePattern}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "iu").test(activation.sql)
        || !new RegExp(`ALTER\\s+TABLE\\s+${tablePattern}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`, "iu").test(activation.sql)
      ) {
        throw stopped(`${table} ENABLE/FORCE source drifted`);
      }
    }
    if (
      (activation.sql.match(/\bCREATE\s+POLICY\b/giu) ?? []).length !== release.policies.length
      || (activation.sql.match(/\bCREATE\s+TRIGGER\b/giu) ?? []).length !== 0
      || !/REVOKE\s+ALL\s+ON\s+TABLE\s+public\."Cart",\s*public\."CartItem"/iu.test(activation.sql)
      || /\bDROP\s+(?:TABLE|COLUMN)\b/iu.test(activation.sql)
    ) {
      throw stopped("migration is not the reviewed cart owner-policy shape");
    }
    for (const policy of release.policies) {
      const command = policy.command === "r"
        ? "SELECT"
        : policy.command === "a"
          ? "INSERT"
          : policy.command === "w"
            ? "UPDATE"
            : policy.command === "d"
              ? "DELETE"
              : null;
      if (
        command === null
        || !new RegExp(
          `CREATE\\s+POLICY\\s+${policy.name}\\s+ON\\s+public\\."${policy.table}"[\\s\\S]*?FOR\\s+${command}[\\s\\S]*?TO\\s+grainline_app_runtime`,
          "iu",
        ).test(activation.sql)
      ) {
        throw stopped(`migration policy ${policy.name} drifted`);
      }
    }
    const serviceFunctionSources = new Map(
      release.serviceFunctions.map((entry) => [
        entry.name,
        functionSourceFromMigration(activation.sql, entry.name),
      ]),
    );
    return Object.freeze({
      releaseId,
      release,
      migrationPath: activation.migrationPath,
      digest: activation.digest,
      serviceFunctionSources,
    });
  }
  if (release.shape === "stock_notification") {
    const retained = migrationArtifact(
      rootDir,
      release.retainedFunctionMigration,
      release.retainedFunctionMigrationSha256,
    );
    const tablePattern = 'public\\."StockNotification"';
    if (
      !new RegExp(
        `ALTER\\s+TABLE\\s+${tablePattern}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        "iu",
      ).test(activation.sql)
      || !new RegExp(
        `ALTER\\s+TABLE\\s+${tablePattern}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        "iu",
      ).test(activation.sql)
      || (activation.sql.match(/\bCREATE\s+POLICY\b/giu) ?? []).length
        !== release.policies.length
      || !/REVOKE\s+ALL\s+ON\s+TABLE\s+public\."StockNotification"/iu.test(
        activation.sql,
      )
      || !/GRANT\s+SELECT,\s*DELETE\s+ON\s+TABLE\s+public\."StockNotification"/iu.test(
        activation.sql,
      )
      || /GRANT\s+(?:INSERT|UPDATE)[\s\S]{0,120}public\."StockNotification"/iu.test(
        activation.sql,
      )
      || /\bCREATE\s+TRIGGER\b/iu.test(activation.sql)
      || /\bDROP\s+(?:TABLE|COLUMN)\b/iu.test(activation.sql)
    ) {
      throw stopped("migration is not the reviewed StockNotification owner-policy shape");
    }
    for (const policy of release.policies) {
      const command = policy.command === "r"
        ? "SELECT"
        : policy.command === "d"
          ? "DELETE"
          : null;
      if (
        command === null
        || !new RegExp(
          `CREATE\\s+POLICY\\s+${policy.name}\\s+ON\\s+${tablePattern}[\\s\\S]*?FOR\\s+${command}[\\s\\S]*?TO\\s+grainline_app_runtime`,
          "iu",
        ).test(activation.sql)
      ) {
        throw stopped(`migration policy ${policy.name} drifted`);
      }
    }
    if (
      (activation.sql.match(/current_setting\('app\.user_id',\s*true\)/gu) ?? [])
        .length !== 2
    ) {
      throw stopped("StockNotification owner context boundary drifted");
    }
    const retainedFunctionSources = new Map(
      release.retainedFunctions.map((entry) => [
        entry.name,
        functionSourceFromMigration(retained.sql, entry.name),
      ]),
    );
    return Object.freeze({
      releaseId,
      release,
      migrationPath: activation.migrationPath,
      digest: activation.digest,
      retainedMigrationPath: retained.migrationPath,
      retainedDigest: retained.digest,
      retainedFunctionSources,
    });
  }
  const retained = migrationArtifact(
    rootDir,
    release.retainedFunctionMigration,
    release.retainedFunctionMigrationSha256,
  );
  const quotedTable = release.table.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const tablePattern = `public\\."${quotedTable}"`;
  if (
    !new RegExp(`ALTER\\s+TABLE\\s+${tablePattern}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "iu").test(activation.sql)
    || !new RegExp(`ALTER\\s+TABLE\\s+${tablePattern}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`, "iu").test(activation.sql)
    || (activation.sql.match(/\bCREATE\s+POLICY\b/giu) ?? []).length !== release.policies.length
    || !new RegExp(`CREATE\\s+TRIGGER\\s+${release.trigger}`, "iu").test(activation.sql)
    || !new RegExp(`CREATE\\s+FUNCTION\\s+public\\.${release.guardFunction}\\(\\)`, "iu").test(activation.sql)
    || !new RegExp(`GRANT\\s+SELECT,\\s*INSERT,\\s*DELETE\\s+ON\\s+TABLE\\s+${tablePattern}`, "iu").test(activation.sql)
    || !new RegExp(`REVOKE\\s+ALL\\s+ON\\s+TABLE\\s+${tablePattern}`, "iu").test(activation.sql)
    || /\bDROP\s+(?:TABLE|COLUMN)\b/iu.test(activation.sql)
  ) {
    throw stopped("migration is not the reviewed combined owner-policy shape");
  }
  for (const policy of release.policies) {
    const command = policy.command === "r"
      ? "SELECT"
      : policy.command === "a"
        ? "INSERT"
        : policy.command === "d"
          ? "DELETE"
          : null;
    if (
      command === null
      || !new RegExp(
        `CREATE\\s+POLICY\\s+${policy.name}\\s+ON\\s+${tablePattern}[\\s\\S]*?FOR\\s+${command}[\\s\\S]*?TO\\s+grainline_app_runtime`,
        "iu",
      ).test(activation.sql)
    ) {
      throw stopped(`migration policy ${policy.name} drifted`);
    }
  }
  if (
    (activation.sql.match(/current_setting\('app\.user_id',\s*true\)/gu) ?? []).length !== 4
  ) {
    throw stopped("owner context boundary drifted");
  }
  const retainedFunctionSources = new Map(
    release.retainedFunctions.map((entry) => [
      entry.name,
      functionSourceFromMigration(retained.sql, entry.name),
    ]),
  );
  const guardFunctionSource = functionSourceFromMigration(
    activation.sql,
    release.guardFunction,
  );
  return Object.freeze({
    releaseId,
    release,
    migrationPath: activation.migrationPath,
    digest: activation.digest,
    retainedMigrationPath: retained.migrationPath,
    retainedDigest: retained.digest,
    retainedFunctionSources,
    guardFunctionSource,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const releaseId = process.env.OWNER_TABLE_RLS_RELEASE_ID ?? "";
    if (
      process.env.OWNER_TABLE_RLS_REVIEWED_PREDECESSOR_DEPLOYMENT_ID
      || process.env.OWNER_TABLE_RLS_REVIEWED_PREDECESSOR_SOURCE_COMMIT
    ) {
      verifyOwnerTableRlsPredecessor(
        releaseId,
        process.env.OWNER_TABLE_RLS_REVIEWED_PREDECESSOR_DEPLOYMENT_ID,
        process.env.OWNER_TABLE_RLS_REVIEWED_PREDECESSOR_SOURCE_COMMIT,
      );
    }
    const verified = verifyOwnerTableRlsActivationSource(releaseId);
    const output = process.argv[2] ?? "--migration";
    if (output === "--migration") {
      process.stdout.write(`${verified.release.migration}\n`);
    } else if (output === "--minimum-compatible-app-commit") {
      process.stdout.write(`${verified.release.minimumCompatibleAppCommit}\n`);
    } else {
      throw stopped("output selector is invalid");
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
