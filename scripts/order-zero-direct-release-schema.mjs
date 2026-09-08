// Read-only schema component. Expected catalog records are committed, never
// learned from the database being admitted. Source DDL is independently replayed
// in tests; the enclosing release scope attests the complete migration bytes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const PRIVATE_TABLES = ["OrderStaffCapability", "SellerDeauthorizationApplication"];
const CONSTRAINTS = ["Order_provider_claim_mutual_exclusion_check",
  "CheckoutStockReservation_sourceSnapshot_check", "Order_sellerDeauthorization_check"];
const INDEXES = ["Order_sellerProfileId_sellerDeauthorizedAt_idx"];
const ADDED_COLUMNS = [["CheckoutStockReservation", "sourceSnapshot"],
  ["Order", "sellerDeauthorizedAt"], ["Order", "sellerDeauthorizationEventId"]];
const sort = rows => rows.toSorted((a, b) => {
  const left = `${a.kind}/${a.table_name}/${a.name}`;
  const right = `${b.kind}/${b.table_name}/${b.name}`;
  return left < right ? -1 : left > right ? 1 : 0;
});

export function expectedZeroDirectSchema(prefixLength) {
  assert.ok(Number.isInteger(prefixLength) && prefixLength >= 0 && prefixLength <= 17,
    "invalid schema prefix length");
  const manifest = JSON.parse(readFileSync(new URL("./order-zero-direct-release-schema.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.records.length, 38, "schema record inventory drifted");
  return sort(manifest.records.filter(row => row.introduced <= prefixLength)
    .map(({ introduced: _introduced, ...row }) => row));
}

export function assertZeroDirectSchema(records, prefixLength) {
  assert.ok(Array.isArray(records), "missing exact prefix schema catalog");
  assert.ok(isDeepStrictEqual(sort(records), expectedZeroDirectSchema(prefixLength)),
    "prefix schema disagrees with reviewed migration state");
}

// Called only inside the enclosing scope's engine-attested read-only transaction.
// Whole private-table inventories are checked. Existing application tables are
// scoped to this prefix's additions, not presented as a whole-schema audit.
export async function readZeroDirectSchema(client, owner) {
  const records = [];
  const columns = (await client.query(`SELECT 'column'::text AS kind, c.relname AS table_name,
      a.attname AS name, pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull AS not_null, pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression,
      a.attidentity::text AS identity, a.attgenerated::text AS generated,
      CASE WHEN a.attcollation=0 THEN NULL ELSE a.attcollation::regcollation::text END AS collation
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE c.relnamespace='public'::regnamespace AND a.attnum>0 AND NOT a.attisdropped
      AND (c.relname=ANY($1::text[]) OR (c.relname,a.attname) IN
        (SELECT * FROM unnest($2::text[],$3::text[])))`,
  [PRIVATE_TABLES, ADDED_COLUMNS.map(r => r[0]), ADDED_COLUMNS.map(r => r[1])])).rows;
  records.push(...columns);
  records.push(...(await client.query(`SELECT 'constraint'::text AS kind, c.relname AS table_name,
      k.conname AS name, k.contype::text AS type, k.convalidated AS validated,
      k.condeferrable AS deferrable, k.condeferred AS deferred, k.connoinherit AS no_inherit,
      k.conislocal AS local, k.coninhcount::integer AS inheritance_count,
      pg_catalog.pg_get_constraintdef(k.oid,false) AS definition
    FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
    WHERE k.connamespace='public'::regnamespace
      AND (c.relname=ANY($1::text[]) OR k.conname=ANY($2::text[]))`,
  [PRIVATE_TABLES, CONSTRAINTS])).rows);
  records.push(...(await client.query(`SELECT 'index'::text AS kind, c.relname AS table_name,
      i.relname AS name, pg_catalog.pg_get_indexdef(x.indexrelid,0,false) AS definition,
      x.indisvalid AS valid, x.indisready AS ready, x.indislive AS live,
      x.indisunique AS unique, x.indisprimary AS primary, x.indisexclusion AS exclusion,
      x.indimmediate AS immediate, pg_catalog.pg_get_userbyid(i.relowner)=$3 AS owner_matches,
      i.relpersistence::text AS persistence, i.reloptions AS options, i.reltablespace=0 AS default_tablespace
    FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class c ON c.oid=x.indrelid
    JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid
    WHERE c.relnamespace='public'::regnamespace
      AND (c.relname=ANY($1::text[]) OR i.relname=ANY($2::text[]))`,
  [PRIVATE_TABLES, INDEXES, owner])).rows);
  records.push(...(await client.query(`SELECT 'trigger'::text AS kind, c.relname AS table_name,
      t.tgname AS name, t.tgenabled::text AS enabled, t.tgtype::integer AS type,
      t.tgisinternal AS internal, t.tgconstraint<>0 AS constraint_trigger,
      t.tgdeferrable AS deferrable, t.tginitdeferred AS initially_deferred,
      t.tgnargs::integer AS argument_count, pg_catalog.encode(t.tgargs,'hex') AS arguments,
      pg_catalog.pg_get_expr(t.tgqual,t.tgrelid) AS when_expression,
      t.tgattr::text AS update_columns, t.tgoldtable AS old_table, t.tgnewtable AS new_table,
      t.tgfoid=pg_catalog.to_regprocedure('public.grainline_seller_deauthorization_application_immutable()') AS function_matches
    FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[])`, [PRIVATE_TABLES])).rows);
  records.push(...(await client.query(`SELECT 'relation'::text AS kind, c.relname AS table_name,
      c.relname AS name, c.relpersistence::text AS persistence, c.relispartition AS partition,
      c.relhasrules AS has_rules, c.reloftype<>0 AS typed_table,
      (SELECT count(*)::integer FROM pg_catalog.pg_inherits h
        WHERE h.inhrelid=c.oid OR h.inhparent=c.oid) AS inheritance_edges
    FROM pg_catalog.pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[])`,
  [["Order", "CheckoutStockReservation", ...PRIVATE_TABLES]])).rows);
  return sort(records);
}
