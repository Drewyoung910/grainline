import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import {
  USER_CROSS_DOMAIN_FUNCTIONS,
  readUserCrossDomainCatalog,
  verifyUserCrossDomainCatalog,
} from "../scripts/user-cross-domain-convergence-production-inspect.mjs";

const identity = Object.freeze({
  current_user: "neondb_owner",
  session_user: "neondb_owner",
  database_name: "neondb",
  read_only: "on",
  isolation: "repeatable read",
  owner_bypass_rls: true,
  runtime_bypass_rls: false,
  runtime_superuser: false,
  runtime_inherit: false,
});

function table(tableName, overrides) {
  return {
    table_name: tableName,
    owner_name: "neondb_owner",
    ...overrides,
  };
}

function catalog(state) {
  const functions = USER_CROSS_DOMAIN_FUNCTIONS.map((entry) => ({
    function_name: entry.name,
    identity_arguments: entry.identityArguments,
    owner_name: "neondb_owner",
    language_name: "plpgsql",
    function_kind: "f",
    security_definer: state === "applied"
      ? entry.appliedDefiner
      : entry.pendingDefiner,
    leakproof: false,
    volatility: "v",
    parallel_safety: "u",
    function_config: ["search_path=pg_catalog"],
    source_md5: state === "applied"
      ? entry.appliedSourceMd5
      : entry.pendingSourceMd5,
    uses_user_table: entry.name !== "grainline_conversation_inbox"
      || state === "pending",
    uses_participant_authority:
      entry.name === "grainline_conversation_inbox" && state === "applied",
    contains_dynamic_execute: false,
    nonowner_acl: entry.runtimeExecute
      ? ["grainline_app_runtime:EXECUTE:false"]
      : [],
  }));
  return {
    identity: { ...identity },
    tables: [
      table("CaseResolutionClaim", {
        rls_enabled: true,
        rls_forced: true,
        policy_count: 0,
        runtime_select: false,
        runtime_insert: false,
        runtime_update: false,
        runtime_delete: false,
        nonowner_acl: [],
        nonowner_column_acl_count: 0,
      }),
      table("Conversation", {
        rls_enabled: true,
        rls_forced: true,
        policy_count: 1,
        runtime_select: true,
        runtime_insert: false,
        runtime_update: false,
        runtime_delete: false,
        nonowner_acl: ["grainline_app_runtime:SELECT:false"],
        nonowner_column_acl_count: 0,
      }),
      table("Message", {
        rls_enabled: true,
        rls_forced: true,
        policy_count: 1,
        runtime_select: true,
        runtime_insert: false,
        runtime_update: false,
        runtime_delete: false,
        nonowner_acl: ["grainline_app_runtime:SELECT:false"],
        nonowner_column_acl_count: 0,
      }),
      table("User", {
        rls_enabled: false,
        rls_forced: false,
        policy_count: 0,
        runtime_select: true,
        runtime_insert: true,
        runtime_update: true,
        runtime_delete: true,
        nonowner_acl: [
          "grainline_app_runtime:DELETE:false",
          "grainline_app_runtime:INSERT:false",
          "grainline_app_runtime:SELECT:false",
          "grainline_app_runtime:UPDATE:false",
        ],
        nonowner_column_acl_count: 0,
      }),
    ],
    functions,
    policies: [
      {
        table_name: "Conversation",
        policy_name: "grainline_conversation_participant_or_reported_select",
        permissive: true,
        command: "r",
        role_names: ["grainline_app_runtime"],
        using_expression: "(((NULLIF(current_setting('app.user_id',true),'')=\"userAId\")OR(NULLIF(current_setting('app.user_id',true),'')=\"userBId\"))ORgrainline_conversation_staff_report_visible(id))",
        with_check_expression: null,
      },
      {
        table_name: "Message",
        policy_name: "grainline_message_participant_or_reported_select",
        permissive: true,
        command: "r",
        role_names: ["grainline_app_runtime"],
        using_expression: "(((NULLIF(current_setting('app.user_id',true),'')=\"senderId\")OR(NULLIF(current_setting('app.user_id',true),'')=\"recipientId\"))ORgrainline_conversation_staff_report_visible(\"conversationId\"))",
        with_check_expression: null,
      },
    ],
    triggers: [{
      trigger_name: "grainline_case_resolution_claim_immutable",
      table_name: "CaseResolutionClaim",
      enabled: "O",
      function_name: "grainline_case_resolution_claim_immutable",
      identity_arguments: "",
    }],
  };
}

test("cross-domain inspector accepts exact pending and applied catalogs", () => {
  assert.equal(
    verifyUserCrossDomainCatalog(catalog("pending"), "pending").functionCount,
    3,
  );
  assert.equal(
    verifyUserCrossDomainCatalog(catalog("applied"), "applied").triggerCount,
    1,
  );
});

test("cross-domain inspector rejects premature User posture changes", () => {
  const enabled = catalog("applied");
  enabled.tables[3].rls_enabled = true;
  assert.throws(
    () => verifyUserCrossDomainCatalog(enabled, "applied"),
    /User\.rls_enabled drifted/,
  );

  const revoked = catalog("applied");
  revoked.tables[3].runtime_update = false;
  assert.throws(
    () => verifyUserCrossDomainCatalog(revoked, "applied"),
    /User\.runtime_update drifted/,
  );
});

test("cross-domain inspector rejects source, mode, ACL and trigger drift", () => {
  const source = catalog("applied");
  source.functions[1].source_md5 = "00000000000000000000000000000000";
  assert.throws(
    () => verifyUserCrossDomainCatalog(source, "applied"),
    /Expected values to be strictly equal/,
  );

  const acl = catalog("applied");
  acl.functions[0].nonowner_acl.push("PUBLIC:EXECUTE:false");
  assert.throws(
    () => verifyUserCrossDomainCatalog(acl, "applied"),
    /Expected values to be strictly deep-equal/,
  );

  const policy = catalog("applied");
  policy.policies[0].using_expression = "true";
  assert.throws(
    () => verifyUserCrossDomainCatalog(policy, "applied"),
    /Expected values to be strictly deep-equal/,
  );

  const trigger = catalog("applied");
  trigger.triggers[0].enabled = "D";
  assert.throws(
    () => verifyUserCrossDomainCatalog(trigger, "applied"),
    /Expected values to be strictly deep-equal/,
  );
});

test("cross-domain inspector reads normalized policies and nonowner ACLs", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
      CREATE TABLE public."User" (id text PRIMARY KEY);
      CREATE TABLE public."Conversation" (
        id text PRIMARY KEY,
        "userAId" text NOT NULL,
        "userBId" text NOT NULL
      );
      CREATE TABLE public."Message" (
        id text PRIMARY KEY,
        "senderId" text NOT NULL,
        "recipientId" text NOT NULL,
        "conversationId" text NOT NULL
      );
      CREATE TABLE public."CaseResolutionClaim" (id text PRIMARY KEY);

      CREATE FUNCTION public.grainline_conversation_staff_report_visible(text)
      RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT false';
      CREATE FUNCTION public.grainline_conversation_inbox(
        p_user_id text,
        p_archived boolean,
        p_query text,
        p_before_at timestamp,
        p_before_id text,
        p_limit integer
      ) RETURNS integer LANGUAGE plpgsql SET search_path = pg_catalog
      AS $body$ BEGIN RETURN 1; END $body$;
      CREATE FUNCTION public.grainline_user_conversation_participants(
        p_actor_id text,
        p_conversation_id text
      ) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog
      AS $body$ BEGIN RETURN 1; END $body$;
      CREATE FUNCTION public.grainline_case_resolution_claim_immutable()
      RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog
      AS $body$ BEGIN RETURN NEW; END $body$;

      ALTER TABLE public."Conversation" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public."Conversation" FORCE ROW LEVEL SECURITY;
      ALTER TABLE public."Message" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public."Message" FORCE ROW LEVEL SECURITY;
      ALTER TABLE public."CaseResolutionClaim" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public."CaseResolutionClaim" FORCE ROW LEVEL SECURITY;

      CREATE POLICY grainline_conversation_participant_or_reported_select
        ON public."Conversation" FOR SELECT TO grainline_app_runtime
        USING (
          NULLIF(pg_catalog.current_setting('app.user_id', true), '')
            IN ("userAId", "userBId")
          OR public.grainline_conversation_staff_report_visible(id)
        );
      CREATE POLICY grainline_message_participant_or_reported_select
        ON public."Message" FOR SELECT TO grainline_app_runtime
        USING (
          NULLIF(pg_catalog.current_setting('app.user_id', true), '')
            IN ("senderId", "recipientId")
          OR public.grainline_conversation_staff_report_visible("conversationId")
        );

      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."User"
        TO grainline_app_runtime;
      GRANT SELECT ON TABLE public."Conversation", public."Message"
        TO grainline_app_runtime;
      REVOKE ALL ON FUNCTION public.grainline_conversation_inbox(
        text, boolean, text, timestamp, text, integer
      ) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.grainline_conversation_inbox(
        text, boolean, text, timestamp, text, integer
      ) TO grainline_app_runtime;
      REVOKE ALL ON FUNCTION public.grainline_user_conversation_participants(
        text, text
      ) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.grainline_user_conversation_participants(
        text, text
      ) TO grainline_app_runtime;
      REVOKE ALL ON FUNCTION public.grainline_case_resolution_claim_immutable()
        FROM PUBLIC;
      CREATE TRIGGER grainline_case_resolution_claim_immutable
        BEFORE UPDATE ON public."CaseResolutionClaim"
        FOR EACH ROW EXECUTE FUNCTION
          public.grainline_case_resolution_claim_immutable();
    `);
    const actual = await readUserCrossDomainCatalog(database);
    assert.equal(actual.tables.length, 4);
    assert.deepEqual(actual.policies.map((entry) => entry.policy_name), [
      "grainline_conversation_participant_or_reported_select",
      "grainline_message_participant_or_reported_select",
    ]);
    assert.deepEqual(actual.policies[0].role_names, ["grainline_app_runtime"]);
    assert.match(
      actual.policies[0].using_expression,
      /grainline_conversation_staff_report_visible\(id\)/,
    );
    assert.deepEqual(
      actual.tables.find((entry) => entry.table_name === "Conversation")
        .nonowner_acl,
      ["grainline_app_runtime:SELECT:false"],
    );
  } finally {
    await database.close();
  }
});
