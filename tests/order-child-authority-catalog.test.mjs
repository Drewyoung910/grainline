import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  ORDER_ITEM_DIRECT_FUNCTIONS,
  ORDER_ITEM_RLS_RELEASE_DIRECT_FUNCTIONS,
  ORDER_ITEM_TRIGGER_FUNCTIONS,
  ORDER_ITEM_TRIGGER_SOURCE_MD5,
  ORDER_QUOTE_DIRECT_FUNCTIONS,
  orderChildExpectedPostureFromEnvironment,
  orderChildSourceCatalog,
  orderChildSourceFunctionCatalog,
  verifyOrderChildAuthorityCatalog,
} from "../scripts/order-child-authority-catalog.mjs";

const owner = "neondb_owner";

function functionRow(source) {
  return {
    function_name: source.name,
    identity_arguments: source.identity.slice(source.identity.indexOf("(") + 1, -1).replaceAll(",", ", "),
    owner_name: owner,
    language_name: source.languageName,
    function_kind: "f",
    security_definer: source.securityDefiner,
    leakproof: source.leakproof,
    volatility: source.volatility,
    parallel_safety: source.parallelSafety,
    function_config: ["search_path=pg_catalog"],
    source_md5: source.sourceMd5,
    contains_dynamic_execute: false,
    touches_order_item: source.touchesOrderItem,
    touches_quote: source.touchesQuote,
    nonowner_acl: ["grainline_app_runtime:EXECUTE:false"],
  };
}

function acceptedCatalog() {
  const sourceCatalog = orderChildSourceFunctionCatalog();
  return {
    identity: {
      actor: owner,
      login: owner,
      database_name: "neondb",
      isolation: "repeatable read",
      read_only: "on",
      rolsuper: false,
      rolbypassrls: true,
      rolinherit: true,
      rolcanlogin: true,
    },
    tables: [
      ["Order", true, true],
      ["OrderItem", false, false],
      ["OrderShippingRateQuote", false, false],
    ].map(([table_name, rls_enabled, rls_forced]) => ({
      table_name,
      owner_name: owner,
      rls_enabled,
      rls_forced,
      policy_count: 0,
      nonowner_table_acl_count: 0,
      nonowner_column_acl_count: 0,
    })),
    functions: sourceCatalog.map(functionRow),
    triggers: ORDER_ITEM_TRIGGER_FUNCTIONS.map((function_name, index) => ({
      table_name: "OrderItem",
      trigger_name: function_name,
      function_name,
      owner_name: owner,
      enabled: "O",
      deferrable: index === 1,
      initially_deferred: index === 1,
      language_name: "plpgsql",
      function_kind: "f",
      security_definer: true,
      leakproof: false,
      function_config: ["search_path=pg_catalog"],
      source_md5: ORDER_ITEM_TRIGGER_SOURCE_MD5[function_name],
      contains_dynamic_execute: false,
      nonowner_acl: [],
    })),
    structure: [{ object_type: "index", table_name: "OrderItem", object_name: "OrderItem_pkey", valid: true }],
  };
}

test("accepted Order child authority catalog is exact and read-only", () => {
  assert.deepEqual(verifyOrderChildAuthorityCatalog(acceptedCatalog()), {
    databaseMode: "production-read-only",
    tableOwner: owner,
    orderItemDirectFunctionCount: 35,
    quoteDirectFunctionCount: 4,
    orderItemTriggerCount: 2,
    rowDataRead: false,
    productionChanged: false,
  });
});

test("reviewed catalog exactly matches latest migration-tree definitions", () => {
  assert.deepEqual(
    orderChildSourceCatalog(),
    [...ORDER_ITEM_DIRECT_FUNCTIONS, ...ORDER_QUOTE_DIRECT_FUNCTIONS].sort(),
  );
  assert.deepEqual(
    orderChildSourceFunctionCatalog()
      .filter((entry) => entry.languageName === "sql")
      .map((entry) => entry.name),
    [
      "grainline_order_buyer_detail_v3",
      "grainline_order_public_marketplace_listing_metrics",
      "grainline_order_seller_detail_v3",
      "grainline_order_summary_items",
    ],
  );
  assert.equal(
    orderChildSourceFunctionCatalog().every(
      (entry) => entry.securityDefiner && !entry.leakproof,
    ),
    true,
  );
  assert.deepEqual(
    orderChildSourceFunctionCatalog(
      process.cwd(),
      "20261001040000_force_order_item_rls",
    )
      .filter((entry) => entry.touchesOrderItem)
      .map((entry) => entry.name)
      .sort(),
    [...ORDER_ITEM_RLS_RELEASE_DIRECT_FUNCTIONS],
  );
});

test("catalog normalizes PostgreSQL ACL booleans before JavaScript verification", () => {
  const source = fs.readFileSync("scripts/order-child-authority-catalog.mjs", "utf8");
  assert.equal(
    (source.match(/CASE WHEN acl\.is_grantable THEN 'true' ELSE 'false' END/gu) ?? []).length,
    2,
  );
  assert.doesNotMatch(source, /\n\s+acl\.is_grantable\n/gu);
});

test("inspection CLI requires an explicit exact child-table posture", () => {
  assert.deepEqual(orderChildExpectedPostureFromEnvironment({
    EXPECTED_ORDER_ITEM_RLS_ENABLED: "true",
    EXPECTED_ORDER_ITEM_RLS_FORCED: "false",
    EXPECTED_ORDER_QUOTE_RLS_ENABLED: "false",
    EXPECTED_ORDER_QUOTE_RLS_FORCED: "false",
  }), {
    orderItemRlsEnabled: true,
    orderItemRlsForced: false,
    quoteRlsEnabled: false,
    quoteRlsForced: false,
  });
  assert.throws(
    () => orderChildExpectedPostureFromEnvironment({}),
    /EXPECTED_ORDER_ITEM_RLS_ENABLED must be true or false/u,
  );
  assert.throws(
    () => orderChildExpectedPostureFromEnvironment({
      EXPECTED_ORDER_ITEM_RLS_ENABLED: "1",
    }),
    /EXPECTED_ORDER_ITEM_RLS_ENABLED must be true or false/u,
  );

  const workflow = fs.readFileSync(
    ".github/workflows/order-child-authority-inspection.yml",
    "utf8",
  );
  assert.match(workflow, /EXPECTED_ORDER_ITEM_RLS_ENABLED: "true"/u);
  assert.match(workflow, /EXPECTED_ORDER_ITEM_RLS_FORCED: "true"/u);
  assert.match(workflow, /EXPECTED_ORDER_QUOTE_RLS_ENABLED: "true"/u);
  assert.match(workflow, /EXPECTED_ORDER_QUOTE_RLS_FORCED: "false"/u);
});

test("the same exact catalog accepts the separate policyless OrderItem ENABLE posture", () => {
  const catalog = acceptedCatalog();
  const orderItem = catalog.tables.find((entry) => entry.table_name === "OrderItem");
  orderItem.rls_enabled = true;
  assert.doesNotThrow(() => verifyOrderChildAuthorityCatalog(
    catalog,
    process.cwd(),
    { orderItemRlsEnabled: true, orderItemRlsForced: false },
  ));
});

test("the same exact catalog accepts OrderItem FORCE plus separate quote ENABLE", () => {
  const catalog = acceptedCatalog();
  const orderItem = catalog.tables.find((entry) => entry.table_name === "OrderItem");
  orderItem.rls_enabled = true;
  orderItem.rls_forced = true;
  const quote = catalog.tables.find(
    (entry) => entry.table_name === "OrderShippingRateQuote",
  );
  quote.rls_enabled = true;
  assert.doesNotThrow(() => verifyOrderChildAuthorityCatalog(
    catalog,
    process.cwd(),
    {
      orderItemRlsEnabled: true,
      orderItemRlsForced: true,
      quoteRlsEnabled: true,
      quoteRlsForced: false,
    },
  ));
});

test("the same exact catalog accepts separate quote FORCE", () => {
  const catalog = acceptedCatalog();
  const orderItem = catalog.tables.find((entry) => entry.table_name === "OrderItem");
  orderItem.rls_enabled = true;
  orderItem.rls_forced = true;
  const quote = catalog.tables.find(
    (entry) => entry.table_name === "OrderShippingRateQuote",
  );
  quote.rls_enabled = true;
  quote.rls_forced = true;
  assert.doesNotThrow(() => verifyOrderChildAuthorityCatalog(
    catalog,
    process.cwd(),
    {
      orderItemRlsEnabled: true,
      orderItemRlsForced: true,
      quoteRlsEnabled: true,
      quoteRlsForced: true,
    },
  ));
});

test("catalog rejects an unreviewed direct function or unsafe authority", () => {
  const extra = acceptedCatalog();
  extra.functions.push({
    ...extra.functions[0],
    function_name: "grainline_unreviewed",
    identity_arguments: "",
  });
  assert.throws(() => verifyOrderChildAuthorityCatalog(extra));

  const publicExecute = acceptedCatalog();
  publicExecute.functions[0].nonowner_acl.push("PUBLIC:EXECUTE:false");
  assert.throws(() => verifyOrderChildAuthorityCatalog(publicExecute), /granted to PUBLIC/u);

  const invoker = acceptedCatalog();
  invoker.functions[0].security_definer = false;
  assert.throws(() => verifyOrderChildAuthorityCatalog(invoker), /not SECURITY DEFINER/u);

  const languageDrift = acceptedCatalog();
  const sqlFunction = languageDrift.functions.find((entry) => entry.language_name === "sql");
  sqlFunction.language_name = "plpgsql";
  assert.throws(() => verifyOrderChildAuthorityCatalog(languageDrift), /language drifted/u);

  const renamedTrigger = acceptedCatalog();
  renamedTrigger.triggers[0].trigger_name = "grainline_unreviewed_trigger";
  assert.throws(() => verifyOrderChildAuthorityCatalog(renamedTrigger));

  const triggerTimingDrift = acceptedCatalog();
  triggerTimingDrift.triggers[1].initially_deferred = false;
  assert.throws(() => verifyOrderChildAuthorityCatalog(triggerTimingDrift));
});
