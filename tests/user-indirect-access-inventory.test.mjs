import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { auditUserIndirectAccess } from "../scripts/audit-user-indirect-access.mjs";

test("User inventory follows schema relations, shared projections, and lexical aliases", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "grainline-user-inventory-"));
  try {
    mkdirSync(path.join(root, "prisma"));
    mkdirSync(path.join(root, "src/lib"), { recursive: true });
    writeFileSync(path.join(root, "prisma/schema.prisma"), `
model User {
  id String
  email String
}
model SellerProfile {
  user User
}
model Listing {
  seller SellerProfile
}
`);
    writeFileSync(path.join(root, "src/lib/shared.ts"), `export const shared = { seller: { select: { user: { select: { email: true } } } } } as const;`);
    writeFileSync(path.join(root, "src/main.ts"), `
import { shared as imported } from "@/lib/shared";
const select = imported;
function blogFilter(): Prisma.ListingWhereInput { return { seller: { user: { email: "x" } } }; }
db.listing.findMany({ select });
db.listing.count({ where: { seller: { is: { user: { email: "value" } } } } });
db.listing.findMany({ include: { seller: { include: { user: false } } } });
db.listing.findMany({ ...(flag ? { include: { seller: { include: { user: true } } } } : {}) });
db.listing.findMany({ where: makeFilter() });
db.user.findFirstOrThrow({ where: { id: "owner" } });
// db.user.deleteMany({});
const prose = "db.user.findMany({})";
const fragment = Prisma.sql\` JOIN "User" u ON u.id = target \`;
db.$queryRaw\`SELECT id FROM "Listing" l \${fragment}\`;
db.$queryRaw\`SELECT 'FROM "User"' AS value FROM "Listing"\`;
db.$queryRaw\`SELECT \${'FROM "User"'} AS value FROM "Listing"\`;
db.$queryRaw\`SELECT id FROM "Listing" /* JOIN "User" */\`;
db.$executeRawUnsafe('UPDATE public."User" SET email = $1', email);
`);
    const report = auditUserIndirectAccess(root);
    assert.equal(report.directCount, 1);
    assert.equal(report.direct[0].method, "findFirstOrThrow");
    assert.equal(report.relationCount, 3);
    assert.deepEqual(report.relations.map(({ path: trail }) => trail), ["select.seller.select.user", "where.seller.is.user", "include.seller.include.user"]);
    assert.deepEqual(report.relations[0].fields, ["email"]);
    assert.equal(report.relations[0].file, "src/lib/shared.ts");
    assert.equal(report.relations[0].query.file, "src/main.ts");
    assert.equal(report.relations[2].fullRow, true);
    assert.equal(report.rawSqlCount, 2);
    assert.deepEqual(report.opaqueShapes.map(({ expression }) => expression), ["makeFilter()"]);
    assert.deepEqual(report.factoryRelations.map(({ function: name, path: trail }) => ({ name, trail })), [{ name: "blogFilter", trail: "return.seller.user" }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
