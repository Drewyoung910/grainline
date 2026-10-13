import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261013210000_move_account_deletion_seller_private_sql_callers/migration.sql",
  "utf8",
);

test("account-deletion redaction derives private needles from SellerProfilePrivate", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE ROLE grainline_app_runtime;
      CREATE TABLE public."User" (
        id text PRIMARY KEY,
        "clerkId" text NOT NULL,
        email text NOT NULL,
        name text,
        "deletedAt" timestamp(3),
        "shippingName" text,
        "shippingLine1" text,
        "shippingLine2" text,
        "shippingCity" text,
        "shippingState" text,
        "shippingPostalCode" text,
        "shippingPhone" text
      );
      CREATE TABLE public."SellerProfile" (
        id text PRIMARY KEY,
        "userId" text NOT NULL UNIQUE,
        "displayName" text NOT NULL,
        city text,
        state text,
        "stripeAccountId" text,
        "stripeAccountVersion" text,
        "stripeControllerType" text,
        "shipFromName" text,
        "shipFromLine1" text,
        "shipFromLine2" text,
        "shipFromCity" text,
        "shipFromState" text,
        "shipFromPostal" text,
        "shipFromPhone" text,
        tagline text,
        "bannerImageUrl" text,
        "avatarImageUrl" text,
        "workshopImageUrl" text,
        "instagramUrl" text,
        "facebookUrl" text,
        "pinterestUrl" text,
        "tiktokUrl" text,
        "websiteUrl" text
      );
      CREATE TABLE public."SellerProfilePrivate" (
        "sellerProfileId" text PRIMARY KEY,
        "stripeAccountId" text,
        "stripeAccountVersion" text,
        "stripeControllerType" text,
        "shipFromName" text,
        "shipFromLine1" text,
        "shipFromLine2" text,
        "shipFromCity" text,
        "shipFromState" text,
        "shipFromPostal" text,
        "shipFromPhone" text
      );
      CREATE TABLE public."AccountDeletionSideEffect" (
        id text PRIMARY KEY,
        "userId" text NOT NULL,
        kind text NOT NULL,
        "dedupKey" text NOT NULL,
        payload jsonb NOT NULL,
        status text NOT NULL
      );
      CREATE TABLE public."UserEmailAddress" (
        id text PRIMARY KEY,
        "userId" text NOT NULL,
        email text NOT NULL
      );
      CREATE TABLE public."Message" (
        id text PRIMARY KEY,
        "senderId" text NOT NULL,
        "recipientId" text NOT NULL,
        body text NOT NULL
      );
      CREATE FUNCTION public.grainline_account_deletion_email_key_core(p_email text)
      RETURNS text LANGUAGE sql IMMUTABLE AS $$
        SELECT pg_catalog.lower(pg_catalog.btrim(p_email))
      $$;
      CREATE FUNCTION public.grainline_account_deletion_redact_text_core(
        p_body text,
        p_sensitive_values text[]
      ) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
      DECLARE
        result text := p_body;
        value text;
      BEGIN
        FOREACH value IN ARRAY p_sensitive_values LOOP
          result := pg_catalog.replace(result, value, '[deleted account]');
        END LOOP;
        RETURN result;
      END
      $$;
      CREATE FUNCTION public.grainline_message_redact_for_account_deletion(p_actor_id text)
      RETURNS TABLE ("sentRedacted" integer, "receivedRedacted" integer)
      LANGUAGE sql SECURITY DEFINER AS $$ SELECT 0, 0 $$;
      REVOKE ALL ON FUNCTION public.grainline_message_redact_for_account_deletion(text)
        FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.grainline_message_redact_for_account_deletion(text)
        TO grainline_app_runtime;
    `);
    await database.exec(migration);
    await database.exec(`
      INSERT INTO public."User" (id, "clerkId", email, name)
      VALUES
        ('target', 'clerk_target', 'target@example.test', 'Target Person'),
        ('sender', 'clerk_sender', 'sender@example.test', 'Sender');
      INSERT INTO public."SellerProfile" (
        id, "userId", "displayName", "shipFromLine1"
      ) VALUES (
        'seller_target', 'target', 'Target Shop', 'legacy poison lane'
      );
      INSERT INTO public."SellerProfilePrivate" (
        "sellerProfileId", "shipFromLine1"
      ) VALUES (
        'seller_target', 'private correct lane'
      );
      INSERT INTO public."Message" (id, "senderId", "recipientId", body)
      VALUES (
        'message_received', 'sender', 'target',
        'private correct lane and legacy poison lane'
      );
      SET ROLE grainline_app_runtime;
    `);
    const result = await database.query(`
      SELECT * FROM public.grainline_message_redact_for_account_deletion('target')
    `);
    await database.exec("RESET ROLE");

    assert.deepEqual(result.rows, [{ sentRedacted: 0, receivedRedacted: 1 }]);
    const message = await database.query(`
      SELECT body FROM public."Message" WHERE id = 'message_received'
    `);
    assert.match(message.rows[0].body, /\[deleted account\]/u);
    assert.match(message.rows[0].body, /legacy poison lane/u);
    assert.doesNotMatch(message.rows[0].body, /private correct lane/u);
  } finally {
    await database.close();
  }
});
