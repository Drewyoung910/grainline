import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import {
  parseOrderZeroDirectCompatiblePrefixProofConfig,
  verifyConstraintsAndTrigger,
  verifyFunctionCatalog,
  verifyTablePosture,
} from "../scripts/order-zero-direct-compatible-prefix-postgres-proof.mjs";
import {
  ORDER_ZERO_DIRECT_COMPATIBLE_RUNTIME_FUNCTIONS,
  ORDER_ZERO_DIRECT_COMPATIBLE_PRIVATE_FUNCTIONS,
} from "../scripts/stage-order-zero-direct-compatible-prefix.mjs";

const ENVIRONMENT = "ORDER_ZERO_DIRECT_COMPATIBLE_PREFIX_PROOF_DATABASE_URL";

describe("Order zero-direct compatible real-PostgreSQL proof", () => {
  it("accepts only a loopback grainline_ci owner connection", () => {
    assert.deepEqual(
      parseOrderZeroDirectCompatiblePrefixProofConfig({
        [ENVIRONMENT]: "postgresql://ci:ci@127.0.0.1:5432/grainline_ci?sslmode=disable",
      }),
      {
        databaseUrl: "postgresql://ci:ci@127.0.0.1:5432/grainline_ci?sslmode=disable",
        expectedRole: "ci",
      },
    );
    for (const databaseUrl of [
      "postgresql://ci:ci@db.example.com:5432/grainline_ci",
      "postgresql://ci:ci@127.0.0.1:5432/production",
      "postgresql://grainline_app_runtime:secret@127.0.0.1:5432/grainline_ci",
    ]) {
      assert.throws(
        () => parseOrderZeroDirectCompatiblePrefixProofConfig({
          [ENVIRONMENT]: databaseUrl,
        }),
      );
    }
  });

  it("is engine-read-only, exact-catalog, and secret-sanitized", () => {
    const source = fs.readFileSync(
      "scripts/order-zero-direct-compatible-prefix-postgres-proof.mjs",
      "utf8",
    );
    assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
    assert.match(source, /current_setting\('transaction_read_only'\)/u);
    assert.match(source, /public\._prisma_migrations/u);
    assert.match(source, /pg_catalog\.oidvectortypes\(procedure\.proargtypes\)/u);
    assert.match(source, /pg_catalog\.aclexplode/u);
    assert.match(source, /class\.oid = catalog_constraint\.conrelid/u);
    assert.match(source, /procedure\.oid = trigger\.tgfoid/u);
    assert.match(source, /\[redacted-postgres-url\]/u);
    assert.doesNotMatch(
      source,
      /\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE)\b/iu,
    );
  });

  it("executes the catalog reader and rejects misplaced constraints or trigger substitution", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE TABLE public."CheckoutStockReservation" (
          id integer CONSTRAINT "CheckoutStockReservation_sourceSnapshot_check" CHECK (id > 0)
        );
        CREATE TABLE public."Order" (
          id integer CONSTRAINT "Order_provider_claim_mutual_exclusion_check" CHECK (id > 0),
          CONSTRAINT "Order_sellerDeauthorization_check" CHECK (id < 10)
        );
        CREATE TABLE public."SellerDeauthorizationApplication" (id integer);
        CREATE FUNCTION public.grainline_seller_deauthorization_application_immutable()
        RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN OLD; END';
        CREATE TRIGGER "SellerDeauthorizationApplication_immutable"
        BEFORE UPDATE OR DELETE ON public."SellerDeauthorizationApplication"
        FOR EACH ROW EXECUTE FUNCTION public.grainline_seller_deauthorization_application_immutable();
      `);
      await verifyConstraintsAndTrigger(db);
      await db.exec(`
        BEGIN;
        ALTER TABLE public."Order" DROP CONSTRAINT "Order_sellerDeauthorization_check";
        CREATE TABLE public.unrelated (
          id integer CONSTRAINT "Order_sellerDeauthorization_check" CHECK (id < 10)
        );
      `);
      await assert.rejects(() => verifyConstraintsAndTrigger(db));
      await db.exec("ROLLBACK");
      await db.exec(`
        BEGIN;
        ALTER TABLE public."SellerDeauthorizationApplication"
          DISABLE TRIGGER "SellerDeauthorizationApplication_immutable";
      `);
      await assert.rejects(() => verifyConstraintsAndTrigger(db));
      await db.exec("ROLLBACK");
      await db.exec(`
        CREATE FUNCTION public.unrelated_trigger()
        RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN OLD; END';
        DROP TRIGGER "SellerDeauthorizationApplication_immutable"
          ON public."SellerDeauthorizationApplication";
        CREATE TRIGGER "SellerDeauthorizationApplication_immutable"
        BEFORE UPDATE OR DELETE ON public."SellerDeauthorizationApplication"
        FOR EACH ROW EXECUTE FUNCTION public.unrelated_trigger();
      `);
      await assert.rejects(() => verifyConstraintsAndTrigger(db));
    } finally {
      await db.close();
    }
  });

  it("checks effective grants, exact overloads, and retained table posture in PostgreSQL", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE ROLE grainline_app_runtime NOINHERIT NOBYPASSRLS;
        CREATE TABLE public."Order" (id integer);
        CREATE TABLE public."SellerDeauthorizationApplication" (id integer);
        GRANT SELECT, INSERT, UPDATE, DELETE ON public."Order" TO grainline_app_runtime;
        ALTER TABLE public."SellerDeauthorizationApplication" ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public."SellerDeauthorizationApplication" FORCE ROW LEVEL SECURITY;
      `);
      for (const [name, types] of [
        ...ORDER_ZERO_DIRECT_COMPATIBLE_RUNTIME_FUNCTIONS,
        ...ORDER_ZERO_DIRECT_COMPATIBLE_PRIVATE_FUNCTIONS,
      ]) {
        const args = types ? types.split(", ").map((type, index) => `p_${index} ${type}`).join(", ") : "";
        await db.exec(`
          CREATE FUNCTION public.${name}(${args}) RETURNS integer
          LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS 'SELECT 1';
          REVOKE ALL ON FUNCTION public.${name}(${types}) FROM PUBLIC;
        `);
      }
      for (const [name, types] of ORDER_ZERO_DIRECT_COMPATIBLE_RUNTIME_FUNCTIONS) {
        await db.exec(`GRANT EXECUTE ON FUNCTION public.${name}(${types}) TO grainline_app_runtime`);
      }
      await verifyFunctionCatalog(db);
      await verifyTablePosture(db);
      const [name, types] = ORDER_ZERO_DIRECT_COMPATIBLE_RUNTIME_FUNCTIONS[0];
      const [privateName, privateTypes] = ORDER_ZERO_DIRECT_COMPATIBLE_PRIVATE_FUNCTIONS[0];
      for (const mutation of [
        `GRANT EXECUTE ON FUNCTION public.${name}(${types}) TO PUBLIC`,
        `GRANT EXECUTE ON FUNCTION public.${name}(${types}) TO grainline_app_runtime WITH GRANT OPTION`,
        `REVOKE EXECUTE ON FUNCTION public.${name}(${types}) FROM grainline_app_runtime`,
        `GRANT EXECUTE ON FUNCTION public.${privateName}(${privateTypes}) TO grainline_app_runtime`,
        `ALTER FUNCTION public.${name}(${types}) SECURITY INVOKER`,
        `ALTER FUNCTION public.${name}(${types}) SET search_path=public`,
        `CREATE FUNCTION public.${name}() RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
      ]) {
        await db.exec(`BEGIN; ${mutation}`);
        await assert.rejects(() => verifyFunctionCatalog(db), mutation);
        await db.exec("ROLLBACK");
      }
      for (const mutation of [
        'ALTER TABLE public."Order" ENABLE ROW LEVEL SECURITY',
        'REVOKE UPDATE ON public."Order" FROM grainline_app_runtime',
        'ALTER TABLE public."SellerDeauthorizationApplication" NO FORCE ROW LEVEL SECURITY',
        'GRANT SELECT ON public."SellerDeauthorizationApplication" TO grainline_app_runtime',
      ]) {
        await db.exec(`BEGIN; ${mutation}`);
        await assert.rejects(() => verifyTablePosture(db), mutation);
        await db.exec("ROLLBACK");
      }
    } finally {
      await db.close();
    }
  });
});
