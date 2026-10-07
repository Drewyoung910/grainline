import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const predecessorPath =
  "prisma/migrations/20260726022500_prepare_conversation_message_authority/migration.sql";
const participantAuthorityPath =
  "prisma/migrations/20261006030000_prepare_user_relationship_authorities/migration.sql";
const convergencePath =
  "prisma/migrations/20261007160000_converge_user_cross_domain_authorities/migration.sql";
const claimContinuityPath =
  "prisma/migrations/20261002020000_correct_case_refund_provider_recovery_continuity/migration.sql";

function functionDefinition(source, name) {
  const declaration = new RegExp(
    `CREATE OR REPLACE FUNCTION\\s+public\\.${name}\\(`,
    "u",
  ).exec(source);
  assert.ok(declaration, `${name} declaration is missing`);
  const start = declaration.index;
  const bodyStart = source.indexOf("\nAS $", start);
  assert.notEqual(bodyStart, -1, `${name} body start is missing`);
  const tag = source.slice(bodyStart + 4, source.indexOf("\n", bodyStart + 4));
  const end = source.indexOf(`\n${tag};`, bodyStart + 4);
  assert.notEqual(end, -1, `${name} body end is missing`);
  return source.slice(start, end + tag.length + 2);
}

const predecessorSql = readFileSync(predecessorPath, "utf8");
const participantAuthoritySql = readFileSync(participantAuthorityPath, "utf8");
const convergenceSql = readFileSync(convergencePath, "utf8");
const claimContinuitySql = readFileSync(claimContinuityPath, "utf8");
const predecessorDefinition = functionDefinition(
  predecessorSql,
  "grainline_conversation_inbox",
);
const participantDefinition = functionDefinition(
  participantAuthoritySql,
  "grainline_user_conversation_participants",
);
const convergedDefinition = functionDefinition(
  convergenceSql,
  "grainline_conversation_inbox",
);
const claimTriggerDefinition = functionDefinition(
  claimContinuitySql,
  "grainline_case_resolution_claim_immutable",
);

function finalDirectUserFunctionModes() {
  const state = new Map();
  const migrationNames = readdirSync("prisma/migrations", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const migrationName of migrationNames) {
    const source = readFileSync(
      `prisma/migrations/${migrationName}/migration.sql`,
      "utf8",
    );
    const declaration = /CREATE OR REPLACE FUNCTION\s+public\.([A-Za-z0-9_]+)\s*\(/gu;
    for (const match of source.matchAll(declaration)) {
      const start = match.index;
      const remainder = source.slice(start);
      const body = /AS\s+(\$[A-Za-z0-9_]*\$)\n([\s\S]*?)\n\1;/u.exec(remainder);
      assert.ok(body, `${match[1]} in ${migrationName} has no parseable body`);
      const header = remainder.slice(0, body.index);
      state.set(match[1], {
        directUserRead: body[2].includes('public."User"'),
        migrationName,
        securityDefiner: /\bSECURITY\s+DEFINER\b/iu.test(header),
      });
    }
    const alteredMode = /ALTER FUNCTION\s+public\.([A-Za-z0-9_]+)\s*\([\s\S]*?\)\s+SECURITY\s+(DEFINER|INVOKER)\s*;/gu;
    for (const match of source.matchAll(alteredMode)) {
      const prior = state.get(match[1]);
      if (prior) {
        state.set(match[1], {
          ...prior,
          modeMigrationName: migrationName,
          securityDefiner: match[2] === "DEFINER",
        });
      }
    }
  }
  return state;
}

async function fixture() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TYPE public."Role" AS ENUM ('USER', 'EMPLOYEE', 'ADMIN');
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      name text,
      "imageUrl" text,
      role public."Role" NOT NULL DEFAULT 'USER',
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3)
    );
    CREATE TABLE public."Conversation" (
      id text PRIMARY KEY,
      "userAId" text NOT NULL,
      "userBId" text NOT NULL,
      "updatedAt" timestamp(3) NOT NULL,
      "archivedAAt" timestamp(3),
      "archivedBAt" timestamp(3),
      "contextListingId" text
    );
    CREATE TABLE public."Message" (
      id text PRIMARY KEY,
      "conversationId" text NOT NULL,
      "senderId" text NOT NULL,
      "recipientId" text NOT NULL,
      body text NOT NULL,
      kind text,
      "createdAt" timestamp(3) NOT NULL,
      "readAt" timestamp(3)
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      title text NOT NULL
    );
    CREATE TABLE public."Photo" (
      id text PRIMARY KEY,
      "listingId" text NOT NULL,
      url text NOT NULL,
      "sortOrder" integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public."Block" (
      id text PRIMARY KEY,
      "blockerId" text NOT NULL,
      "blockedId" text NOT NULL
    );
    CREATE TABLE public."UserReport" (
      id text PRIMARY KEY,
      "targetType" text,
      "targetId" text,
      resolved boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."CaseResolutionClaim" (
      id text PRIMARY KEY
    );

    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."User"
      TO grainline_app_runtime;
    GRANT SELECT ON TABLE
      public."Conversation",
      public."Message",
      public."Listing",
      public."Photo",
      public."Block"
      TO grainline_app_runtime;

    ALTER TABLE public."Conversation" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public."Conversation" FORCE ROW LEVEL SECURITY;
    ALTER TABLE public."Message" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public."Message" FORCE ROW LEVEL SECURITY;

    CREATE POLICY grainline_conversation_test_select
      ON public."Conversation"
      FOR SELECT
      TO grainline_app_runtime
      USING (
        pg_catalog.current_setting('app.user_id', true)
          IN ("userAId", "userBId")
      );
    CREATE POLICY grainline_message_test_select
      ON public."Message"
      FOR SELECT
      TO grainline_app_runtime
      USING (
        EXISTS (
          SELECT 1
            FROM public."Conversation" AS conversation
           WHERE conversation.id = "conversationId"
        )
      );

    ALTER TABLE public."CaseResolutionClaim" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public."CaseResolutionClaim" FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public."CaseResolutionClaim"
      FROM PUBLIC, grainline_app_runtime;
  `);
  await database.exec(participantDefinition);
  await database.exec(`
    REVOKE ALL ON FUNCTION
      public.grainline_user_conversation_participants(text, text)
      FROM PUBLIC, grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION
      public.grainline_user_conversation_participants(text, text)
      TO grainline_app_runtime;
  `);
  await database.exec(predecessorDefinition);
  await database.exec(`
    REVOKE ALL ON FUNCTION public.grainline_conversation_inbox(
      text, boolean, text, timestamp, text, integer
    ) FROM PUBLIC, grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION public.grainline_conversation_inbox(
      text, boolean, text, timestamp, text, integer
    ) TO grainline_app_runtime;
  `);
  await database.exec(claimTriggerDefinition);
  await database.exec(`
    REVOKE ALL ON FUNCTION public.grainline_case_resolution_claim_immutable()
      FROM PUBLIC, grainline_app_runtime;
    CREATE TRIGGER grainline_case_resolution_claim_immutable
      BEFORE UPDATE ON public."CaseResolutionClaim"
      FOR EACH ROW
      EXECUTE FUNCTION public.grainline_case_resolution_claim_immutable();
  `);
  return database;
}

test("convergence replaces only the inbox User reads and preserves its invoker boundary", () => {
  assert.match(convergenceSql, /2a7fceb40f06e9934749c06516209f3a/u);
  assert.match(convergenceSql, /44c3946959d09676749bdf7e0c9e286c/u);
  assert.match(convergenceSql, /4b2884765f4ca0db432c4678f98b1bdd/u);
  assert.match(convergenceSql, /06289e9db780c559e07188c20e680887/u);
  assert.match(convergedDefinition, /SECURITY INVOKER/u);
  assert.match(
    convergedDefinition,
    /public\.grainline_user_conversation_participants\(\s*p_user_id,\s*conversation\.id\s*\)/su,
  );
  assert.doesNotMatch(convergedDefinition, /public\."User"/u);
  assert.match(
    convergedDefinition,
    /p_user_id IN \(conversation\."userAId", conversation\."userBId"\)/u,
  );
  assert.match(convergedDefinition, /FROM public\."Block" AS block/u);
  assert.match(convergedDefinition, /LIMIT bounded_limit/u);
  assert.match(
    convergenceSql,
    /ALTER FUNCTION public\.grainline_case_resolution_claim_immutable\(\)\s+SECURITY DEFINER/su,
  );
});

test("all remaining cross-domain direct User readers finish as definer authorities", () => {
  const modes = finalDirectUserFunctionModes();
  const externalReaders = [...modes.entries()]
    .filter(([name, state]) => (
      !name.startsWith("grainline_user_") && state.directUserRead
    ));
  assert.ok(externalReaders.length > 50, "cross-domain inventory unexpectedly shrank");
  assert.deepEqual(
    externalReaders
      .filter(([, state]) => !state.securityDefiner)
      .map(([name]) => name),
    [],
  );
  assert.equal(
    modes.get("grainline_case_resolution_claim_immutable")?.securityDefiner,
    true,
  );
  assert.equal(
    modes.get("grainline_conversation_inbox")?.directUserRead,
    false,
  );
});

test("policyless User ENABLE denies direct reads while the actor inbox keeps working", async () => {
  const database = await fixture();
  try {
    await database.exec(convergenceSql);
    const claimTrigger = await database.query(`
      SELECT procedure.prosecdef AS security_definer,
             pg_catalog.md5(procedure.prosrc) AS source_md5,
             pg_catalog.has_function_privilege(
               'grainline_app_runtime', procedure.oid, 'EXECUTE'
             ) AS runtime_execute
        FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid = pg_catalog.to_regprocedure(
         'public.grainline_case_resolution_claim_immutable()'
       )
    `);
    assert.deepEqual(claimTrigger.rows, [{
      security_definer: true,
      source_md5: "06289e9db780c559e07188c20e680887",
      runtime_execute: false,
    }]);
    await database.exec(`
      INSERT INTO public."User" (id, name, "imageUrl") VALUES
        ('actor', 'Actor Name', 'actor.jpg'),
        ('target', 'Target Name', 'target.jpg'),
        ('outsider', 'Outsider Name', NULL),
        ('foreign', 'Foreign Name', NULL);
      INSERT INTO public."Conversation" (
        id, "userAId", "userBId", "updatedAt"
      ) VALUES
        ('conversation-visible', 'actor', 'target', '2026-10-07T12:00:00'),
        ('conversation-foreign', 'outsider', 'foreign', '2026-10-07T13:00:00');
      INSERT INTO public."Message" (
        id, "conversationId", "senderId", "recipientId", body, "createdAt"
      ) VALUES
        ('message-visible', 'conversation-visible', 'target', 'actor',
         'visible message', '2026-10-07T12:00:00'),
        ('message-foreign', 'conversation-foreign', 'foreign', 'outsider',
         'foreign message', '2026-10-07T13:00:00');

      REVOKE ALL ON TABLE public."User"
        FROM PUBLIC, grainline_app_runtime;
      ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public."User" NO FORCE ROW LEVEL SECURITY;
      SET ROLE grainline_app_runtime;
    `);

    await assert.rejects(
      database.query('SELECT id FROM public."User"'),
      /permission denied|42501/iu,
    );

    const inbox = await database.query(`
      SELECT * FROM public.grainline_conversation_inbox(
        'actor', false, '', NULL, NULL, 51
      )
    `);
    assert.equal(inbox.rows.length, 1);
    assert.equal(inbox.rows[0].id, "conversation-visible");
    assert.equal(inbox.rows[0].userAName, "Actor Name");
    assert.equal(inbox.rows[0].userBName, "Target Name");
    assert.equal(Number(inbox.rows[0].unreadCount), 1);

    const searched = await database.query(`
      SELECT id FROM public.grainline_conversation_inbox(
        'actor', false, 'Target Name', NULL, NULL, 51
      )
    `);
    assert.deepEqual(searched.rows, [{ id: "conversation-visible" }]);

    const foreign = await database.query(`
      SELECT id FROM public.grainline_conversation_inbox(
        'actor', false, 'Foreign Name', NULL, NULL, 51
      )
    `);
    assert.deepEqual(foreign.rows, []);
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
