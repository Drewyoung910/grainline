import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import {
  buildCaseCorrectnessMigration,
  caseCorrectnessDefinitions,
} from "../scripts/build-case-correctness-migration.mjs";

test("corrected Case functions apply and project legacy staff in PostgreSQL", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE grainline_app_runtime;
      CREATE TYPE public."Role" AS ENUM ('USER', 'EMPLOYEE', 'ADMIN');
      CREATE TYPE public."CaseResolution" AS ENUM (
        'REFUND_FULL', 'REFUND_PARTIAL', 'DISMISSED'
      );
      CREATE TYPE public."CaseMessageAuthorKind" AS ENUM (
        'BUYER', 'SELLER', 'STAFF'
      );
      SET check_function_bodies = off;
    `);

    const { original } = caseCorrectnessDefinitions();
    await db.exec(Object.values(original).join("\n\n"));
    await db.exec(`
      DO $grant_predecessor_posture$
      DECLARE
        function_row record;
      BEGIN
        FOR function_row IN
          SELECT routine.oid, routine.proname
            FROM pg_catalog.pg_proc AS routine
            JOIN pg_catalog.pg_namespace AS namespace
              ON namespace.oid = routine.pronamespace
           WHERE namespace.nspname = 'public'
             AND routine.proname LIKE 'grainline_%'
        LOOP
          EXECUTE pg_catalog.format(
            'REVOKE ALL ON FUNCTION %s FROM PUBLIC, grainline_app_runtime',
            function_row.oid::pg_catalog.regprocedure
          );
          IF function_row.proname <> 'grainline_case_seller_refund_apply' THEN
            EXECUTE pg_catalog.format(
              'GRANT EXECUTE ON FUNCTION %s TO grainline_app_runtime',
              function_row.oid::pg_catalog.regprocedure
            );
          END IF;
        END LOOP;
      END
      $grant_predecessor_posture$;
    `);
    await db.exec(buildCaseCorrectnessMigration());

    const catalog = await db.query(`
      SELECT
        routine.proname AS function_name,
        routine.prosrc AS function_source,
        routine.proconfig AS function_config,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          routine.oid,
          'EXECUTE'
        ) AS runtime_execute
      FROM pg_catalog.pg_proc AS routine
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'public'
        AND routine.proname IN (
          'grainline_case_message_page',
          'grainline_case_seller_refund_apply',
          'grainline_case_staff_resolution_prepare',
          'grainline_case_staff_resolution_finalize',
          'grainline_order_buyer_pii_prune_batch',
          'grainline_case_account_deletion_redact'
        )
      ORDER BY routine.proname
    `);
    assert.equal(catalog.rows.length, 6);
    assert.equal(
      catalog.rows.find(
        (row) => row.function_name === 'grainline_case_seller_refund_apply',
      )?.runtime_execute,
      false,
    );
    assert.ok(
      catalog.rows
        .filter((row) => row.function_name !== 'grainline_case_seller_refund_apply')
        .every((row) => row.runtime_execute === true),
    );
    assert.ok(
      catalog.rows.every(
        (row) => JSON.stringify(row.function_config)
          === JSON.stringify(["search_path=pg_catalog"]),
      ),
    );
    assert.ok(
      catalog.rows.every(
        (row) => !row.function_source.includes(
          "pg_catalog.clock_timestamp()::timestamp(3)",
        ),
      ),
    );

    await db.exec(`
      SET check_function_bodies = on;
      CREATE TABLE public."User" (
        id text PRIMARY KEY,
        role public."Role" NOT NULL DEFAULT 'USER',
        banned boolean NOT NULL DEFAULT false,
        "deletedAt" timestamp(3)
      );
      CREATE TABLE public."Case" (
        id text PRIMARY KEY,
        "buyerId" text,
        "sellerId" text
      );
      CREATE TABLE public."CaseMessage" (
        id text PRIMARY KEY,
        "caseId" text NOT NULL,
        "authorId" text,
        "authorKind" public."CaseMessageAuthorKind",
        body text NOT NULL,
        "createdAt" timestamp(3) NOT NULL
      );
      CREATE TABLE public."CaseMessageAttachment" (
        id text PRIMARY KEY,
        "caseMessageId" text NOT NULL,
        "contentType" text NOT NULL,
        "byteSize" integer NOT NULL,
        "createdAt" timestamp(3) NOT NULL
      );

      INSERT INTO public."User" (id) VALUES ('buyer');
      INSERT INTO public."User" (id, role) VALUES ('staff', 'EMPLOYEE');
      INSERT INTO public."Case" (id, "buyerId", "sellerId")
      VALUES ('case-1', 'buyer', 'seller');
      INSERT INTO public."CaseMessage" (
        id, "caseId", "authorId", "authorKind", body, "createdAt"
      ) VALUES (
        'legacy-staff-message', 'case-1', 'staff', NULL,
        'Legacy staff message.', timestamp '2026-01-01 12:00:00'
      );
    `);

    const page = await db.query(`
      SELECT *
        FROM public.grainline_case_message_page(
          'buyer', 'case-1', NULL, NULL, 10
        )
    `);
    assert.equal(page.rows.length, 1);
    assert.equal(page.rows[0].authorKind, "STAFF");
    assert.deepEqual(page.rows[0].attachments, []);
  } finally {
    await db.close();
  }
});
