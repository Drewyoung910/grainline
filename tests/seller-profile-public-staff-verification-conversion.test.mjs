import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/admin/verification/page.tsx", "utf8");

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("Guild rejection notifications use the atomic transition identity", () => {
  for (const action of ["rejectGuildMember", "rejectGuildMaster"]) {
    const body = functionBody(page, action);
    assert.doesNotMatch(body, /prisma\.makerVerification\.findUnique/u);
    assert.doesNotMatch(body, /sellerProfile:\s*\{/u);
    assert.match(body, /userId: rejection\.sellerUserId/u);
  }

  const memberBody = functionBody(page, "rejectGuildMember");
  assert.match(memberBody, /displayName: rejection\.sellerDisplayName/u);
  assert.match(memberBody, /sellerProfileId: rejection\.sellerProfileId/u);
});

test("pending Guild Member cards resolve public seller labels through the bounded staff authority", () => {
  assert.match(
    page,
    /memberPendingCount,[\s\S]*memberPendingSourcePage,[\s\S]*masterPendingCount,[\s\S]*featuredNow,[\s\S]*= await Promise\.all/u,
  );
  assert.match(page, /makerVerificationStaffPendingPage\(staffClient, \{/u);
  assert.match(page, /actorId: staff\.id,[\s\S]{0,80}take: STAFF_FETCH_SIZE/u);
  assert.match(page, /makerVerificationStaffPendingCount\(staffClient, staff\.id\)/u);
  assert.doesNotMatch(page, /prisma\.makerVerification\./u);
  assert.doesNotMatch(
    page,
    /where: \{ status: "PENDING" \}[\s\S]{0,400}(?:include|select): \{[\s\S]{0,250}sellerProfile:/u,
  );
  assert.match(page, /sellerProfileStaffReportTargets\(staffClient, \{/u);
  assert.match(page, /actorId: staff\.id/u);
  assert.match(page, /sellerProfileIds: memberPendingSource\.map\(\(verification\) => verification\.sellerProfileId\)/u);
  assert.match(page, /throw new Error\("Guild Member staff projection omitted a pending seller"\)/u);
});
