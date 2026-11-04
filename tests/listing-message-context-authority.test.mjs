import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql",
  "utf8",
);

function migrationSection(start, end) {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex);
  assert.ok(startIndex >= 0, `missing migration section start: ${start}`);
  assert.ok(endIndex >= 0, `missing migration section end: ${end}`);
  return migration.slice(startIndex, endIndex + end.length);
}

const contextAuthority = migrationSection(
  "CREATE FUNCTION public.grainline_listing_message_context_titles(",
  "TO grainline_app_runtime;",
);
const messageListAuthority = migrationSection(
  "CREATE OR REPLACE FUNCTION public.grainline_message_list(",
  "$grainline_message_list$;",
);

test("message history resolves every referenced listing through a participant-safe authority", () => {
  assert.match(
    contextAuthority,
    /CREATE FUNCTION public\.grainline_listing_message_context_titles\(\s*p_conversation_id text/u,
  );
  assert.match(contextAuthority, /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog/u);
  assert.match(contextAuthority, /current_setting\('app\.user_id', true\)/u);
  assert.match(contextAuthority, /conversation\."userAId" = actor_id[\s\S]*conversation\."userBId" = actor_id/u);
  assert.match(contextAuthority, /grainline_conversation_staff_report_visible\(conversation\.id\)/u);
  assert.match(contextAuthority, /message\."contextListingId" = listing\.id/u);
  assert.match(contextAuthority, /message\."conversationId" = conversation\.id/u);
  assert.match(
    contextAuthority,
    /GRANT EXECUTE ON FUNCTION public\.grainline_listing_message_context_titles\(text\)\s+TO grainline_app_runtime/u,
  );
});

test("message list retains invoker isolation and no longer reads Listing directly", () => {
  assert.match(messageListAuthority, /SECURITY INVOKER/u);
  assert.match(messageListAuthority, /grainline_listing_message_context_titles\(\s*p_conversation_id\s*\)/u);
  assert.match(messageListAuthority, /context_listing\.title::text/u);
  assert.doesNotMatch(messageListAuthority, /JOIN public\."Listing" AS listing/u);
  assert.match(messageListAuthority, /IF p_direction = 'before'[\s\S]*ELSE[\s\S]*END IF;/u);
  assert.match(messageListAuthority, /LIMIT bounded_limit/u);
});

test("message history keeps each retained listing title without direct Listing access", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
      CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT;
      CREATE TABLE public."Conversation" (
        id text PRIMARY KEY,
        "userAId" text NOT NULL,
        "userBId" text NOT NULL
      );
      CREATE TABLE public."Listing" (
        id text PRIMARY KEY,
        title varchar(200) NOT NULL
      );
      CREATE TABLE public."Message" (
        id text PRIMARY KEY,
        "conversationId" text NOT NULL,
        "senderId" text NOT NULL,
        "recipientId" text NOT NULL,
        body varchar(5000) NOT NULL,
        kind varchar(32),
        "contextListingId" text,
        "createdAt" timestamp(3) NOT NULL,
        "readAt" timestamp(3)
      );
      CREATE FUNCTION public.grainline_conversation_staff_report_visible(text)
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = pg_catalog
      AS 'SELECT false';
      REVOKE ALL ON FUNCTION public.grainline_conversation_staff_report_visible(text)
        FROM PUBLIC, grainline_app_runtime;
      GRANT EXECUTE ON FUNCTION public.grainline_conversation_staff_report_visible(text)
        TO grainline_app_runtime;
      GRANT SELECT ON public."Conversation", public."Message"
        TO grainline_app_runtime;
      INSERT INTO public."Conversation" (id, "userAId", "userBId")
      VALUES ('conversation-1', 'participant-a', 'participant-b');
      INSERT INTO public."Listing" (id, title) VALUES
        ('listing-1', 'First retained title'),
        ('listing-2', 'Second retained title');
      INSERT INTO public."Message" (
        id, "conversationId", "senderId", "recipientId", body, kind,
        "contextListingId", "createdAt"
      ) VALUES
        (
          'message-1', 'conversation-1', 'participant-a', 'participant-b',
          'First', 'TEXT', 'listing-1', '2026-11-02 12:00:00'
        ),
        (
          'message-2', 'conversation-1', 'participant-b', 'participant-a',
          'Second', 'TEXT', 'listing-2', '2026-11-02 12:01:00'
        );
    `);
    await database.exec(contextAuthority);
    await database.exec(messageListAuthority);

    await database.query("SELECT set_config('app.user_id', 'participant-a', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    const participantRows = (await database.query(`
      SELECT id, "contextListingId", "contextListingTitle"
        FROM public.grainline_message_list(
          'participant-a', 'conversation-1', 'after', NULL, NULL, 50
        )
       ORDER BY id
    `)).rows;
    assert.deepEqual(participantRows, [
      {
        id: "message-1",
        contextListingId: "listing-1",
        contextListingTitle: "First retained title",
      },
      {
        id: "message-2",
        contextListingId: "listing-2",
        contextListingTitle: "Second retained title",
      },
    ]);
    await assert.rejects(
      database.query('SELECT id FROM public."Listing"'),
      /permission denied/u,
    );

    await database.exec("RESET ROLE");
    await database.query("SELECT set_config('app.user_id', 'unrelated-user', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    const unrelatedRows = (await database.query(`
      SELECT id
        FROM public.grainline_message_list(
          'unrelated-user', 'conversation-1', 'after', NULL, NULL, 50
        )
    `)).rows;
    assert.deepEqual(unrelatedRows, []);
    assert.deepEqual(
      (await database.query(`
        SELECT *
          FROM public.grainline_listing_message_context_titles('conversation-1')
      `)).rows,
      [],
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
