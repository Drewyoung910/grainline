import assert from "node:assert/strict";
import test from "node:test";
import {
  SELLER_PROFILE_CONVERTED_AUTHORITY_FUNCTIONS,
  SELLER_PROFILE_INTERNAL_SUPPORT_FUNCTIONS,
  SELLER_PROFILE_TRIGGER_DISPOSITIONS,
  classifySellerProfileDatabaseObjects,
} from "../scripts/seller-profile-public-catalog-disposition.mjs";

function functionRow(signature, executeGrantees, runtimeExecute = false) {
  return {
    signature,
    security_definer: true,
    config: ["search_path=pg_catalog"],
    execute_grantees: executeGrantees,
    runtime_execute: runtimeExecute,
    public_execute: false,
  };
}

function fixture() {
  const functions = [
    ...[...SELLER_PROFILE_INTERNAL_SUPPORT_FUNCTIONS]
      .map((signature) => functionRow(signature, ["ci"])),
    ...[...SELLER_PROFILE_CONVERTED_AUTHORITY_FUNCTIONS]
      .map((signature) => functionRow(signature, ["ci", "grainline_app_runtime"], true)),
    ...Array.from({ length: 91 }, (_, index) => functionRow(
      `grainline_fixture_runtime_${index}(text)`,
      ["ci", "grainline_app_runtime"],
      true,
    )),
    ...Array.from({ length: 7 }, (_, index) => functionRow(
      `grainline_fixture_staff_${index}(text)`,
      ["ci", "grainline_staff_read_runtime"],
    )),
  ];
  const triggers = [...SELLER_PROFILE_TRIGGER_DISPOSITIONS].map(
    ([triggerName, functionSignature]) => ({
      trigger_name: triggerName,
      function_signature: functionSignature,
      table_name: '"SellerProfile"',
    }),
  );
  return { functions, triggers };
}

test("SellerProfile catalog disposition accepts only the reviewed ACL partition", () => {
  const result = classifySellerProfileDatabaseObjects(fixture());
  assert.deepEqual(result.functionDispositions, {
    retainedAuthority: 98,
    internalSupport: 32,
    convertedAuthority: 9,
    retiredPredecessor: 0,
  });
  assert.equal(result.sellerProfileTriggerDispositions.length, 6);
});

test("SellerProfile catalog disposition rejects new internal or PUBLIC authority", () => {
  const unexpectedInternal = fixture();
  unexpectedInternal.functions[0] = functionRow("grainline_unreviewed_internal()", ["ci"]);
  assert.throws(
    () => classifySellerProfileDatabaseObjects(unexpectedInternal),
    /internal function disposition drifted/u,
  );

  const publicExecutable = fixture();
  publicExecutable.functions[32].public_execute = true;
  assert.throws(
    () => classifySellerProfileDatabaseObjects(publicExecutable),
    /executable by PUBLIC/u,
  );
});
