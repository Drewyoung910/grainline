import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  requiredRuntimeTablePrivileges,
} from "../scripts/audit-runtime-db-grants.mjs";

const inventory = Object.freeze({
  rlsPolicyTables: [],
  rlsEnableTables: [],
  rlsForceTables: [],
});

describe("service and reference table least privilege", () => {
  it("requires only the operations exercised by current application callers", () => {
    assert.deepEqual(requiredRuntimeTablePrivileges("SiteConfig", inventory), ["SELECT"]);
    assert.deepEqual(requiredRuntimeTablePrivileges("SystemAuditLog", inventory), [
      "SELECT",
      "INSERT",
    ]);
    assert.deepEqual(requiredRuntimeTablePrivileges("FoundingMakerGrant", inventory), ["SELECT"]);
    assert.deepEqual(requiredRuntimeTablePrivileges("Metro", inventory), [
      "SELECT",
      "INSERT",
      "UPDATE",
    ]);
    assert.deepEqual(requiredRuntimeTablePrivileges("SiteMetricsSnapshot", inventory), [
      "SELECT",
      "INSERT",
      "UPDATE",
    ]);
    assert.deepEqual(
      requiredRuntimeTablePrivileges("SellerExactMapConsentEvent", inventory),
      [],
    );
  });
});
