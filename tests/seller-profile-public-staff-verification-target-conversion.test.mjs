import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/admin/verification/page.tsx", "utf8");
const access = readFileSync("src/lib/sellerProfileStaffAccess.ts", "utf8");

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("Guild approval actions resolve the exact verification through isolated staff authority", () => {
  for (const action of ["approveGuildMember", "approveGuildMaster"]) {
    const body = functionBody(page, action);
    assert.doesNotMatch(body, /prisma\.makerVerification\.findUnique/u);
    assert.doesNotMatch(body, /sellerProfile:\s*\{/u);
    assert.match(body, /sellerProfileStaffVerificationTarget\(getOrderStaffReadClient\(\), \{/u);
    assert.match(body, /actorId: me\.id/u);
    assert.match(body, /verificationId/u);
  }

  assert.match(access, /grainline_seller_staff_verification_target/u);
  assert.match(access, /SellerProfileStaffVerificationTarget/u);
});
