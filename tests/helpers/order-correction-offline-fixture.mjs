import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { correctionCompositionBundle } from "../../scripts/order-correction-composition-manifest.mjs";

export async function offlineCompositionFixture() {
  const url = "postgresql://ci:ci@localhost:5432/grainline_ci?sslmode=disable";
  const schema = execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "diff",
    "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"], {
    encoding: "utf8", maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE ci SUPERUSER; CREATE ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS; SET ROLE ci");
    await db.exec(schema);
    await db.exec("CREATE TABLE public._prisma_migrations(id text PRIMARY KEY)");
    const install = async (definition, name, args, runtimeExecute) => {
      await db.exec(definition);
      await db.exec(`REVOKE ALL ON FUNCTION public.${name}(${args}) FROM PUBLIC`);
      if (runtimeExecute) await db.exec(`GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO grainline_app_runtime`);
    };
    for (const def of correctionCompositionBundle().flatMap((p) => p.definitions)) {
      await install(def.before, def.name, def.args, def.runtimeExecute);
    }
    const history = (migration) => readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8");
    const extract = (sql, name) => {
      const tag = `$${name}$;`;
      const start = sql.search(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`));
      const end = sql.indexOf(tag, start);
      assert.ok(start >= 0 && end > start);
      return sql.slice(start, end + tag.length);
    };
    for (const [migration, name, args, runtime] of [
      ["20260729060000_prepare_case_escalation_cron_authority", "grainline_case_cron_transition_batch", "text,integer", true],
      ["20260722051500_prepare_notification_rls", "grainline_notification_create_order_event", 'text,text,public."NotificationType",text,text,text', true],
      ["20260810190000_prepare_checkout_stock_reservation_authority", "grainline_checkout_reservation_restore_items", "jsonb", false],
    ]) await install(extract(history(migration), name), name, args, runtime);
    const repair = history("20260810190000_prepare_checkout_stock_reservation_authority");
    const start = repair.indexOf("CREATE FUNCTION public.grainline_checkout_reservation_items_valid(");
    const end = repair.indexOf('CREATE INDEX "CheckoutStockReservation_repair_claim_idx"', start);
    assert.ok(start > 0 && end > start);
    await db.exec(repair.slice(start, end));
    const caseSql = history("20260730010000_enforce_case_message_invariants");
    const caseStart = caseSql.indexOf('ALTER TABLE public."Case"\n  ADD CONSTRAINT "Case_distinct_participants_check"');
    const caseEnd = caseSql.indexOf('ALTER TABLE public."CaseMessage"', caseStart);
    assert.ok(caseStart > 0 && caseEnd > caseStart);
    await db.exec(caseSql.slice(caseStart, caseEnd));
    const label = history("20260901140000_prepare_order_label_authority");
    const labelStart = label.indexOf('ALTER TABLE public."Order"\n  ADD CONSTRAINT');
    const labelEnd = label.indexOf('CREATE UNIQUE INDEX "Order_labelClaimId_key"', labelStart);
    assert.ok(labelStart > 0 && labelEnd > labelStart);
    await db.exec(label.slice(labelStart, labelEnd));
    await db.exec(`ALTER TABLE public."CheckoutStockReservation" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public."CheckoutStockReservation" FORCE ROW LEVEL SECURITY;
      ALTER TABLE public."Notification" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public."Notification" FORCE ROW LEVEL SECURITY;
      GRANT SELECT, UPDATE(read) ON public."Notification" TO grainline_app_runtime;`);
    return db;
  } catch (error) { await db.close(); throw error; }
}
