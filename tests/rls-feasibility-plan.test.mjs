import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import ts from "typescript";

function source(path) {
  return fs.readFileSync(path, "utf8");
}

function sourceFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
    });
}

function staticPropertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (
    ts.isComputedPropertyName(name) &&
    (ts.isStringLiteral(name.expression) || ts.isNoSubstitutionTemplateLiteral(name.expression))
  ) {
    return name.expression.text;
  }
  return null;
}

function parseTypeScript(file, fileSource) {
  return ts.createSourceFile(
    file,
    fileSource,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function savedSearchRelationAccesses(file, fileSource) {
  const parsed = parseTypeScript(file, fileSource);
  const accesses = [];

  function visit(node) {
    if (
      ts.isPropertyAssignment(node) &&
      (staticPropertyName(node.name) === "include" || staticPropertyName(node.name) === "select") &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const relationContainer = staticPropertyName(node.name);
      for (const property of node.initializer.properties) {
        if (property.name && staticPropertyName(property.name) === "savedSearches") {
          accesses.push(`${relationContainer}.savedSearches`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(parsed);
  return accesses;
}

function savedSearchDelegateAccesses(file, fileSource) {
  const parsed = parseTypeScript(file, fileSource);
  const accesses = [];

  function visit(node) {
    if (ts.isPropertyAccessExpression(node) && node.name.text === "savedSearch") {
      accesses.push(".savedSearch");
    }
    if (
      ts.isElementAccessExpression(node)
      && node.argumentExpression
      && (
        ts.isStringLiteral(node.argumentExpression)
        || ts.isNoSubstitutionTemplateLiteral(node.argumentExpression)
      )
      && node.argumentExpression.text === "savedSearch"
    ) {
      accesses.push('["savedSearch"]');
    }
    ts.forEachChild(node, visit);
  }

  visit(parsed);
  return accesses;
}

function plainSavedSearchShorthandProperties(file, fileSource) {
  const parsed = parseTypeScript(file, fileSource);
  const properties = [];

  function visit(node) {
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === "savedSearches") {
      const container = node.parent?.parent;
      const isRelationAccess =
        ts.isPropertyAssignment(container) &&
        (staticPropertyName(container.name) === "include" || staticPropertyName(container.name) === "select");
      if (!isRelationAccess) properties.push("savedSearches");
    }
    ts.forEachChild(node, visit);
  }

  visit(parsed);
  return properties;
}

describe("RLS feasibility plan guardrails", () => {
  it("allows only the gated SavedSearch prototype while keeping broad production RLS disabled", () => {
    const plan = source("docs/rls-feasibility-plan.md");

    assert.match(plan, /Do not enable broad or untested RLS directly on production tables/);
    assert.match(
      plan,
      /`SavedSearch`[\s\S]*may be activated only after its staging context, locality, role-separation,[\s\S]*exact-policy, route-fixture, and rollback gates pass/,
    );
    assert.match(plan, /1\. \*\*SavedSearch\*\*[\s\S]*2\. \*\*Notification\*\*/);
    assert.match(plan, /58 model tables/);
    assert.match(plan, /exact row id/);
  });

  it("requires role separation and transaction-local request context", () => {
    const plan = source("docs/rls-feasibility-plan.md");

    assert.match(plan, /Runtime app role/);
    assert.match(plan, /must not own tables/i);
    assert.match(plan, /must not have `BYPASSRLS`/i);
    assert.match(plan, /set_config\('app\.user_id', \$userId, true\)/);
    assert.match(plan, /server-resolved authenticated local `User\.id`/);
    assert.match(plan, /request body, query string, route param, or other client-supplied value/);
    assert.match(plan, /transaction-local/);
  });

  it("requires performance proof before widening interactive transaction wrappers", () => {
    const plan = source("docs/rls-feasibility-plan.md");
    const defense = source("docs/db-defense-in-depth-plan.md");

    assert.match(plan, /protected-read p95\/p99 latency/);
    assert.match(plan, /interactive-transaction\s+`timeout`\/`maxWait`/);
    assert.match(plan, /connection-hold time/);
    assert.match(plan, /pool saturation/);
    assert.match(plan, /ALTER TABLE \.\.\. DISABLE ROW LEVEL SECURITY/);
    assert.match(plan, /set_config` wrapper harmless/);
    assert.match(defense, /protected-read latency/);
    assert.match(defense, /connection-hold time/);
    assert.match(defense, /set_config` wrapper as a harmless no-op/);
    assert.match(defense, /generic connection\/performance baseline/);
  });

  it("defines concrete staging pass/fail criteria for pooled request context", () => {
    const defense = source("docs/db-defense-in-depth-plan.md");
    const runbook = source("docs/runbook.md");

    assert.match(defense, /Staging Pooling\/Context-Isolation Acceptance Spec/);
    assert.match(defense, /pooled runtime-role `DATABASE_URL`/);
    assert.match(defense, /current_setting\('app\.user_id', true\)/);
    assert.match(defense, /Explicitly empty `app\.user_id`/);
    assert.match(defense, /Concurrent transactions[\s\S]*distinct users[\s\S]*pooled `DATABASE_URL`/);
    assert.match(defense, /pooled connection turnover between users/);
    assert.match(defense, /`pg` pool\s+`maxUses`/);
    assert.match(defense, /Serializable retry tests force at least one retry/);
    assert.match(defense, /Promise\.all/);
    assert.match(defense, /prepared-statement, cached-plan, or transaction-pool protocol errors/);
    assert.match(defense, /prepared statement already exists/);
    assert.match(defense, /prepared statement\s+does not exist/);
    assert.match(defense, /p95 latency is more than 2x\s+baseline or increases by more than 100ms/);
    assert.match(defense, /p99 latency is more than 3x\s+baseline or increases by more than 250ms/);
    assert.match(defense, /Prisma interactive\s+transaction `timeout` or `maxWait`/);
    assert.match(defense, /P2028/);
    assert.match(defense, /connection acquisition wait is above 100ms at p95/);
    assert.match(defense, /p99 hold time exceeds 50%/);
    assert.match(defense, /two consecutive\s+runs on the same commit\/config/);
    assert.match(defense, /Post-rollout drift monitoring/);
    assert.match(defense, /sampled production invariant/);
    assert.match(defense, /synthetic canary/);
    assert.match(runbook, /RLS staging context proof/);
    assert.match(runbook, /pooling\/context-isolation acceptance spec/);
    assert.match(runbook, /autocommit baseline, transaction baseline, and wrapped p95\/p99/);
    assert.match(runbook, /connection turnover\/recycling method/);
    assert.match(runbook, /prepared-statement\/cached-plan\s+error scan result/);
    assert.match(runbook, /flaky repeated result as a stop signal/);
    assert.match(runbook, /Never point the mutating `audit:rls-saved-search` fixture gate at production/);
    assert.match(runbook, /After production rollout[\s\S]*non-mutating catalog\/grant audit/);
  });

  it("inventories hidden notification read and update paths before the first policy", () => {
    const plan = source("docs/rls-feasibility-plan.md");
    const defense = source("docs/db-defense-in-depth-plan.md");
    const messageThread = source("src/app/messages/[id]/page.tsx");
    const stockRoute = source("src/app/api/listings/[id]/stock/route.ts");
    const ownerAccess = source("src/lib/notificationOwnerAccess.ts");

    for (const doc of [plan, defense]) {
      assert.match(doc, /message-thread auto-mark-read updates/);
      assert.match(doc, /seller manual-stock\s+low-stock notification dedupe reads/);
      assert.match(doc, /authenticated-seller user context/);
      assert.match(doc, /Webhook\/cron\/admin\s+low-stock/);
      assert.match(doc, /service\/write-path/);
    }
    assert.match(stockRoute, /where: \{ id, seller: \{ userId: me\.id \} \}/);
    assert.match(stockRoute, /seller: \{ select: \{ id: true, userId: true \} \}/);
    assert.match(messageThread, /markOwnerMessageNotificationsRead\(me\.id, id\)/);
    assert.match(stockRoute, /findRecentOwnerLowStockNotification\(/);
    assert.match(ownerAccess, /export async function markOwnerMessageNotificationsRead/);
    assert.match(ownerAccess, /type: NotificationType\.NEW_MESSAGE/);
    assert.match(ownerAccess, /export async function findRecentOwnerLowStockNotification/);
    assert.match(ownerAccess, /type: NotificationType\.LOW_STOCK/);
  });

  it("centralizes Notification owner reads and updates for the second RLS prototype", () => {
    const ownerAccess = source("src/lib/notificationOwnerAccess.ts");
    const bellRoute = source("src/app/api/notifications/route.ts");
    const readAllRoute = source("src/app/api/notifications/read-all/route.ts");
    const readOneRoute = source("src/app/api/notifications/[id]/read/route.ts");
    const dashboardNotifications = source("src/app/dashboard/notifications/page.tsx");
    const dashboard = source("src/app/dashboard/page.tsx");
    const accountExport = source("src/app/api/account/export/route.ts");

    assert.match(ownerAccess, /export async function ownerNotificationBellData/);
    assert.match(ownerAccess, /export async function markOwnerNotificationRead/);
    assert.match(ownerAccess, /export async function markOwnerNotificationsRead/);
    assert.match(ownerAccess, /export async function ownerNotificationPageRows/);
    assert.match(ownerAccess, /export async function ownerNotificationExportRows/);
    assert.match(ownerAccess, /export type NotificationOwnerAccessClient = Pick<Prisma\.TransactionClient, "notification">/);
    assert.match(ownerAccess, /db: NotificationOwnerAccessClient = prisma/);
    assert.match(ownerAccess, /countUnreadOwnerNotifications\(userId, db\)/);
    assert.match(ownerAccess, /ownerNotificationPageRows\(userId, \{ skip, take \}, db\)/);
    assert.match(ownerAccess, /db\.notification\.findMany/);
    assert.match(ownerAccess, /db\.notification\.updateMany/);
    assert.match(ownerAccess, /db\.notification\.findFirst/);
    assert.match(ownerAccess, /where: \{ userId/);
    assert.doesNotMatch(ownerAccess, /Promise\.all/);
    assert.doesNotMatch(ownerAccess, /prisma\.notification\.(?:count|findMany|findFirst|updateMany)/);

    assert.match(bellRoute, /ownerNotificationBellData\(me\.id\)/);
    assert.match(readAllRoute, /markOwnerNotificationsRead\(me\.id, ids\)/);
    assert.match(readOneRoute, /markOwnerNotificationRead\(me\.id, id\)/);
    assert.match(dashboardNotifications, /markOwnerNotificationsRead\(me\.id\)/);
    assert.match(dashboardNotifications, /ownerNotificationPageRows\(me\.id/);
    assert.match(dashboard, /countUnreadOwnerNotifications\(me\.id\)/);
    assert.match(accountExport, /ownerNotificationExportRows\(user\.id\)/);
  });

  it("blocks new direct owner-style Notification reads and updates outside the owner helper", () => {
    const directNotificationAccessPattern =
      /\b[A-Za-z_$][\w$]*\.notification\.(?:count|findMany|findFirst|findUnique|update|updateMany)\b/g;
    const allowedDirectCalls = {
      "src/lib/accountDeletion.ts": ["tx.notification.update"],
      "src/lib/notifications.ts": ["prisma.notification.findUnique"],
    };
    const directCallsByFile = {};

    for (const file of sourceFiles("src")) {
      if (file === "src/lib/notificationOwnerAccess.ts") continue;
      const matches = [...source(file).matchAll(directNotificationAccessPattern)].map((match) => match[0]);
      if (matches.length > 0) directCallsByFile[file] = matches;
    }

    assert.deepEqual(directCallsByFile, allowedDirectCalls);
  });

  it("requires context-wrapped SavedSearch access for the first real-table RLS prototype", () => {
    const ownerAccess = source("src/lib/savedSearchOwnerAccess.ts");
    const savedRoute = source("src/app/api/search/saved/route.ts");
    const dashboard = source("src/app/dashboard/page.tsx");
    const accountOverview = source("src/app/account/page.tsx");
    const accountSavedSearches = source("src/app/account/saved-searches/page.tsx");
    const accountExport = source("src/app/api/account/export/route.ts");
    const accountDeletion = source("src/lib/accountDeletion.ts");

    assert.match(ownerAccess, /SavedSearchOwnerAccessClient = DbUserContextTransactionClient/);
    assert.match(ownerAccess, /export type OwnerSavedSearchCriteria/);
    assert.match(ownerAccess, /export function ownerSavedSearchWhere/);
    assert.match(ownerAccess, /export async function findDuplicateOwnerSavedSearch/);
    assert.match(ownerAccess, /export async function countOwnerSavedSearches/);
    assert.match(ownerAccess, /export async function createOwnerSavedSearch/);
    assert.match(ownerAccess, /export async function listOwnerSavedSearches/);
    assert.match(ownerAccess, /export async function deleteOwnerSavedSearch/);
    assert.match(ownerAccess, /export async function deleteAllOwnerSavedSearches/);
    assert.doesNotMatch(ownerAccess, /SavedSearchOwnerAccessClient = prisma/);
    assert.doesNotMatch(ownerAccess, /from "@\/lib\/db"/);
    assert.match(ownerAccess, /db\.savedSearch\.findFirst/);
    assert.match(ownerAccess, /db\.savedSearch\.count/);
    assert.match(ownerAccess, /db\.savedSearch\.create/);
    assert.match(ownerAccess, /db\.savedSearch\.findMany/);
    assert.match(ownerAccess, /db\.savedSearch\.deleteMany/);
    assert.match(ownerAccess, /rows\.some\(\(row\) => row\.userId !== userId\)/);
    assert.match(ownerAccess, /SavedSearch owner invariant failed/);
    assert.doesNotMatch(ownerAccess, /Promise\.all/);
    assert.doesNotMatch(ownerAccess, /prisma\.savedSearch\.(?:count|create|deleteMany|findFirst|findMany)/);

    assert.match(savedRoute, /withSerializableDbUserContext\(me\.id, async \(tx\) =>/);
    assert.match(savedRoute, /findDuplicateOwnerSavedSearch\(me\.id, criteria, tx\)/);
    assert.match(savedRoute, /countOwnerSavedSearches\(me\.id, tx\)/);
    assert.match(savedRoute, /createOwnerSavedSearch\(me\.id, criteria, tx\)/);
    assert.match(savedRoute, /withDbUserContext\(me\.id, \(tx\) => listOwnerSavedSearches\(me\.id, tx\)\)/);
    assert.match(savedRoute, /withDbUserContext\(me\.id, \(tx\) => deleteOwnerSavedSearch\(me\.id, id, tx\)\)/);
    assert.match(dashboard, /withDbUserContext\(me\.id, \(tx\) => listOwnerSavedSearches\(me\.id, tx, \{ take: 20 \}\)\)/);
    assert.match(dashboard, /withDbUserContext\(me\.id, \(tx\) => deleteOwnerSavedSearch\(me\.id, searchId, tx\)\)/);
    assert.match(accountOverview, /withDbUserContext\(me\.id, \(tx\) => listOwnerSavedSearches\(me\.id, tx, \{ take: 3 \}\)\)/);
    assert.match(accountSavedSearches, /withDbUserContext\(me\.id, \(tx\) => listOwnerSavedSearches\(me\.id, tx\)\)/);
    assert.match(accountSavedSearches, /withDbUserContext\(me\.id, \(tx\) => deleteOwnerSavedSearch\(me\.id, searchId, tx\)\)/);
    assert.match(accountExport, /withDbUserContext\(user\.id, \(tx\) => listOwnerSavedSearches\(user\.id, tx\)\)/);
    assert.match(accountDeletion, /withDbUserContext\(userId, async \(tx\) =>/);
    assert.match(accountDeletion, /deleteAllOwnerSavedSearches\(user\.id, tx\)/);
    assert.doesNotMatch(accountDeletion, /setDbUserContext/);
    const deletionTransactionStart = accountDeletion.indexOf("const result = await withDbUserContext(userId, async (tx) => {");
    const deletionContextSet = deletionTransactionStart;
    const deletionUserRead = accountDeletion.indexOf("const user = await tx.user.findUnique", deletionTransactionStart);
    assert.notEqual(deletionTransactionStart, -1);
    assert.notEqual(deletionContextSet, -1);
    assert.notEqual(deletionUserRead, -1);
    assert.ok(
      deletionContextSet < deletionUserRead,
      "account deletion must set target-user context before any transaction query",
    );
  });

  it("blocks new direct owner-style SavedSearch reads and writes outside the owner helper", () => {
    const directSavedSearchAccessPattern =
      /\b[A-Za-z_$][\w$]*\.savedSearch\.(?:aggregate|count|create|createMany|createManyAndReturn|delete|deleteMany|findFirst|findFirstOrThrow|findMany|findUnique|findUniqueOrThrow|groupBy|update|updateMany|updateManyAndReturn|upsert)\b/g;
    const bracketSavedSearchAccessPattern =
      /\b[A-Za-z_$][\w$]*\s*\[\s*["']savedSearch["']\s*\]/g;
    const rawSavedSearchSqlPattern =
      /\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|MERGE\s+INTO|COPY)\s+(?:ONLY\s+)?(?:(?:public|"public")\.)?"SavedSearch"(?=[\s;,) ]|$)/gi;
    const prismaRawPattern = /\bPrisma\.raw\s*\(/g;
    const unsafeRawPattern = /\.\$(?:queryRawUnsafe|executeRawUnsafe)\b/g;
    const allowedDirectCalls = {};
    const allowedUnsafeRawCalls = {
      "src/app/commission/page.tsx": [".$queryRawUnsafe", ".$queryRawUnsafe"],
    };
    const allowedPlainSavedSearchShorthandProperties = {
      "src/app/api/account/export/route.ts": ["savedSearches"],
    };
    const directCallsByFile = {};
    const plainSavedSearchShorthandPropertiesByFile = {};

    assert.match("prisma.savedSearch.upsert", directSavedSearchAccessPattern);
    directSavedSearchAccessPattern.lastIndex = 0;
    assert.match("prisma.savedSearch.createManyAndReturn", directSavedSearchAccessPattern);
    directSavedSearchAccessPattern.lastIndex = 0;
    assert.match("tx.savedSearch.updateManyAndReturn", directSavedSearchAccessPattern);
    directSavedSearchAccessPattern.lastIndex = 0;
    assert.match('tx["savedSearch"]', bracketSavedSearchAccessPattern);
    bracketSavedSearchAccessPattern.lastIndex = 0;
    assert.match('SELECT * FROM public."SavedSearch"', rawSavedSearchSqlPattern);
    rawSavedSearchSqlPattern.lastIndex = 0;
    assert.match('TRUNCATE TABLE ONLY "public"."SavedSearch"', rawSavedSearchSqlPattern);
    rawSavedSearchSqlPattern.lastIndex = 0;
    assert.match('MERGE INTO public."SavedSearch" AS target', rawSavedSearchSqlPattern);
    rawSavedSearchSqlPattern.lastIndex = 0;
    assert.match('COPY "SavedSearch" (id, "userId") FROM STDIN', rawSavedSearchSqlPattern);
    rawSavedSearchSqlPattern.lastIndex = 0;
    assert.deepEqual(
      savedSearchDelegateAccesses("fixture.ts", "const delegate = tx.savedSearch; delegate.findMany();"),
      [".savedSearch"],
    );
    assert.deepEqual(
      savedSearchDelegateAccesses("fixture.ts", 'const delegate = tx["savedSearch"]; delegate.findMany();'),
      ['["savedSearch"]'],
    );
    assert.match(`Prisma.raw('"SavedSearch"')`, prismaRawPattern);
    prismaRawPattern.lastIndex = 0;
    assert.match("prisma.$queryRawUnsafe(sqlBuiltElsewhere)", unsafeRawPattern);
    unsafeRawPattern.lastIndex = 0;
    assert.deepEqual(
      savedSearchRelationAccesses(
        "fixture.ts",
        "prisma.user.findUnique({ include: { savedSearches: true } });",
      ),
      ["include.savedSearches"],
    );
    assert.deepEqual(
      savedSearchRelationAccesses(
        "fixture.ts",
        "prisma.user.findUnique({ select: { id: true, savedSearches: { select: { id: true } } } });",
      ),
      ["select.savedSearches"],
    );
    assert.deepEqual(
      savedSearchRelationAccesses("fixture.ts", "buildAccountExportPayload({ savedSearches });"),
      [],
    );
    assert.deepEqual(
      plainSavedSearchShorthandProperties("fixture.ts", "buildAccountExportPayload({ savedSearches });"),
      ["savedSearches"],
    );

    for (const file of sourceFiles("src")) {
      const fileSource = source(file);
      const relationAccesses = savedSearchRelationAccesses(file, fileSource);
      const delegateAccesses = file === "src/lib/savedSearchOwnerAccess.ts"
        ? []
        : savedSearchDelegateAccesses(file, fileSource);
      const matches = [
        ...(file === "src/lib/savedSearchOwnerAccess.ts"
          ? []
          : [...fileSource.matchAll(directSavedSearchAccessPattern)].map((match) => match[0])),
        ...(file === "src/lib/savedSearchOwnerAccess.ts"
          ? []
          : [...fileSource.matchAll(bracketSavedSearchAccessPattern)].map((match) => match[0])),
        ...[...fileSource.matchAll(rawSavedSearchSqlPattern)].map((match) => match[0]),
        ...[...fileSource.matchAll(prismaRawPattern)].map((match) => match[0]),
        ...delegateAccesses,
        ...relationAccesses,
      ];
      if (matches.length > 0) directCallsByFile[file] = matches;

      const unsafeRawCalls = [...fileSource.matchAll(unsafeRawPattern)].map((match) => match[0]);
      if (unsafeRawCalls.length > 0) {
        assert.deepEqual(
          unsafeRawCalls,
          allowedUnsafeRawCalls[file] ?? [],
          `${file} contains an unreviewed unsafe raw-query escape hatch`,
        );
      }

      const shorthandProperties = plainSavedSearchShorthandProperties(file, fileSource);
      if (shorthandProperties.length > 0) {
        plainSavedSearchShorthandPropertiesByFile[file] = shorthandProperties;
      }
    }

    assert.deepEqual(directCallsByFile, allowedDirectCalls);
    assert.deepEqual(
      plainSavedSearchShorthandPropertiesByFile,
      allowedPlainSavedSearchShorthandProperties,
    );
  });

  it("centralizes Cart and CartItem owner reads and writes for the parent-join RLS prototype", () => {
    const ownerAccess = source("src/lib/cartOwnerAccess.ts");
    const cartRoute = source("src/app/api/cart/route.ts");
    const cartAdd = source("src/app/api/cart/add/route.ts");
    const cartUpdate = source("src/app/api/cart/update/route.ts");
    const checkoutSeller = source("src/app/api/cart/checkout-seller/route.ts");
    const checkoutResume = source("src/app/api/cart/checkout/resume/route.ts");
    const shippingQuote = source("src/app/api/shipping/quote/route.ts");
    const accountExport = source("src/app/api/account/export/route.ts");

    assert.match(ownerAccess, /export type CartOwnerAccessClient = Pick<Prisma\.TransactionClient, "cart" \| "cartItem" \| "\$queryRaw">/);
    assert.match(ownerAccess, /export function ownerCartWhere/);
    assert.match(ownerAccess, /export function ownerCartItemWhere/);
    assert.match(ownerAccess, /cart: \{ userId \}/);
    assert.match(ownerAccess, /SELECT id FROM "Cart" WHERE id = \$\{cartId\} AND "userId" = \$\{userId\} FOR UPDATE/);
    assert.match(ownerAccess, /if \(rows\.length !== 1\) throw new Error\("Cart not found"\)/);
    assert.match(ownerAccess, /export async function ownerCartForDisplay/);
    assert.match(ownerAccess, /export async function upsertOwnerCart/);
    assert.match(ownerAccess, /export async function ownerCartByUserId/);
    assert.match(ownerAccess, /export async function findOwnerCartItemByVariant/);
    assert.match(ownerAccess, /export async function ownerCartItemStats/);
    assert.match(ownerAccess, /export async function createOwnerCartItem/);
    assert.match(ownerAccess, /export async function updateOwnerCartItemQuantity/);
    assert.match(ownerAccess, /export async function updateOwnerCartItemPrice/);
    assert.match(ownerAccess, /export async function ownerCartForCheckoutSeller/);
    assert.match(ownerAccess, /export async function ownerCartForCheckoutResume/);
    assert.match(ownerAccess, /export async function ownerCartForShippingQuoteById/);
    assert.match(ownerAccess, /export async function ownerCartForShippingQuote/);
    assert.match(ownerAccess, /export async function ownerCartExportRows/);
    assert.match(ownerAccess, /db\.cart\.findUnique/);
    assert.match(ownerAccess, /db\.cart\.findFirst/);
    assert.match(ownerAccess, /db\.cart\.upsert/);
    assert.match(ownerAccess, /db\.cartItem\.findFirst/);
    assert.match(ownerAccess, /db\.cartItem\.findMany/);
    assert.match(ownerAccess, /db\.cartItem\.aggregate/);
    assert.match(ownerAccess, /db\.cartItem\.create/);
    assert.match(ownerAccess, /db\.cartItem\.updateMany/);
    assert.match(ownerAccess, /db\.cartItem\.deleteMany/);
    assert.doesNotMatch(ownerAccess, /Promise\.all/);
    assert.doesNotMatch(ownerAccess, /prisma\.(?:cart|cartItem)\.(?:findUnique|findFirst|findMany|upsert|aggregate|create|update|updateMany|delete|deleteMany)/);

    assert.match(cartRoute, /ownerCartForDisplay\(me\.id\)/);
    assert.match(cartAdd, /upsertOwnerCart\(me\.id\)/);
    assert.match(cartAdd, /lockOwnerCart\(me\.id, cart\.id, tx\)/);
    assert.match(cartAdd, /createOwnerCartItem\(/);
    assert.match(cartAdd, /incrementOwnerCartItemQuantity\(/);
    assert.match(cartUpdate, /ownerCartByUserId\(me\.id\)/);
    assert.match(cartUpdate, /findOwnerCartItemById\(me\.id, cart\.id, cartItemId\)/);
    assert.match(cartUpdate, /ownerCartItemsByListing\(me\.id, cart\.id, listingId\)/);
    assert.match(cartUpdate, /updateOwnerCartItemQuantity\(/);
    assert.match(cartUpdate, /deleteOwnerCartItem\(/);
    assert.match(checkoutSeller, /ownerCartForCheckoutSeller\(me\.id\)/);
    assert.match(checkoutSeller, /updateOwnerCartItemPrice\(me\.id, cart\.id, item\.id/);
    assert.match(checkoutResume, /ownerCartForCheckoutResume\(me\.id\)/);
    assert.match(shippingQuote, /ownerCartForShippingQuoteById\(me\.id, body\.cartId, body\.sellerId\)/);
    assert.match(shippingQuote, /ownerCartForShippingQuote\(me\.id, body\.sellerId\)/);
    assert.match(accountExport, /ownerCartExportRows\(user\.id\)/);
  });

  it("blocks new direct owner-style Cart and CartItem access outside the owner helper", () => {
    const directCartAccessPattern =
      /\b[A-Za-z_$][\w$]*\.(?:cart|cartItem)\.(?:aggregate|count|create|delete|deleteMany|findFirst|findMany|findUnique|upsert|update|updateMany)\b/g;
    const allowedDirectCalls = {
      "src/app/api/admin/listings/[id]/route.ts": ["tx.cartItem.deleteMany"],
      "src/app/api/stripe/webhook/route.ts": [
        "prisma.cart.findUnique",
        "tx.cartItem.deleteMany",
        "tx.cartItem.deleteMany",
      ],
      "src/lib/accountDeletion.ts": ["tx.cart.deleteMany"],
      "src/lib/checkoutStockRestore.ts": ["tx.cartItem.findMany"],
      "src/lib/listingSoftDelete.ts": ["tx.cartItem.deleteMany"],
    };
    const directCallsByFile = {};

    for (const file of sourceFiles("src")) {
      if (file === "src/lib/cartOwnerAccess.ts") continue;
      const matches = [...source(file).matchAll(directCartAccessPattern)].map((match) => match[0]);
      if (matches.length > 0) directCallsByFile[file] = matches;
    }

    assert.deepEqual(directCallsByFile, allowedDirectCalls);
  });

  it("centralizes SavedBlogPost owner reads and writes for the direct-owner RLS prototype", () => {
    const ownerAccess = source("src/lib/savedBlogPostOwnerAccess.ts");
    const homepage = source("src/app/page.tsx");
    const blogIndex = source("src/app/blog/page.tsx");
    const blogAuthor = source("src/app/blog/author/[slug]/page.tsx");
    const blogDetail = source("src/app/blog/[slug]/page.tsx");
    const saveRoute = source("src/app/api/blog/[slug]/save/route.ts");
    const accountFeed = source("src/app/api/account/feed/route.ts");
    const accountExport = source("src/app/api/account/export/route.ts");
    const accountSaved = source("src/app/account/saved/page.tsx");

    assert.match(ownerAccess, /export type SavedBlogPostOwnerAccessClient = Pick<Prisma\.TransactionClient, "savedBlogPost">/);
    assert.match(ownerAccess, /export function ownerSavedBlogPostWhere/);
    assert.match(ownerAccess, /export async function findOwnerSavedBlogPost/);
    assert.match(ownerAccess, /export async function upsertOwnerSavedBlogPost/);
    assert.match(ownerAccess, /export async function deleteOwnerSavedBlogPost/);
    assert.match(ownerAccess, /export async function ownerSavedBlogPostIdRows/);
    assert.match(ownerAccess, /export async function countVisibleOwnerSavedBlogPosts/);
    assert.match(ownerAccess, /export async function ownerSavedBlogPostPageRows/);
    assert.match(ownerAccess, /export async function ownerSavedBlogPostExportRows/);
    assert.match(ownerAccess, /db: SavedBlogPostOwnerAccessClient = prisma/);
    assert.match(ownerAccess, /db\.savedBlogPost\.findUnique/);
    assert.match(ownerAccess, /db\.savedBlogPost\.upsert/);
    assert.match(ownerAccess, /db\.savedBlogPost\.deleteMany/);
    assert.match(ownerAccess, /db\.savedBlogPost\.findMany/);
    assert.match(ownerAccess, /db\.savedBlogPost\.count/);
    assert.match(ownerAccess, /ownerSavedBlogPostWhere\(userId/);
    assert.doesNotMatch(ownerAccess, /Promise\.all/);
    assert.doesNotMatch(ownerAccess, /prisma\.savedBlogPost\.(?:count|findMany|findUnique|upsert|deleteMany)/);

    assert.match(homepage, /ownerSavedBlogPostIdRows\(meDbId, blogPostIds\)/);
    assert.match(blogIndex, /ownerSavedBlogPostIdRows\(meDbId, allPosts\.map\(\(p\) => p\.id\)\)/);
    assert.match(blogAuthor, /ownerSavedBlogPostIdRows\(meDbId, posts\.map\(\(post\) => post\.id\)\)/);
    assert.match(blogDetail, /findOwnerSavedBlogPost\(meId, post\.id\)/);
    assert.match(saveRoute, /findOwnerSavedBlogPost\(me\.id, post\.id\)/);
    assert.match(saveRoute, /upsertOwnerSavedBlogPost\(me\.id, post\.id\)/);
    assert.match(saveRoute, /deleteOwnerSavedBlogPost\(me\.id, post\.id\)/);
    assert.match(accountFeed, /ownerSavedBlogPostIdRows\(me\.id, blogPostIds\)/);
    assert.match(accountExport, /ownerSavedBlogPostExportRows\(user\.id\)/);
    assert.match(accountSaved, /countVisibleOwnerSavedBlogPosts\(me\.id, savedPostBlogWhere\)/);
    assert.match(accountSaved, /ownerSavedBlogPostPageRows\(me\.id, \{/);
  });

  it("blocks new direct owner-style SavedBlogPost reads and writes outside the owner helper", () => {
    const directSavedBlogPostAccessPattern =
      /\b[A-Za-z_$][\w$]*\.savedBlogPost\.(?:count|create|delete|deleteMany|findFirst|findMany|findUnique|upsert|update|updateMany)\b/g;
    const allowedDirectCalls = {
      "src/lib/accountDeletion.ts": ["tx.savedBlogPost.deleteMany"],
    };
    const directCallsByFile = {};

    for (const file of sourceFiles("src")) {
      if (file === "src/lib/savedBlogPostOwnerAccess.ts") continue;
      const matches = [...source(file).matchAll(directSavedBlogPostAccessPattern)].map((match) => match[0]);
      if (matches.length > 0) directCallsByFile[file] = matches;
    }

    assert.deepEqual(directCallsByFile, allowedDirectCalls);
  });

  it("keeps public discovery tables out of the first RLS pass", () => {
    const plan = source("docs/rls-feasibility-plan.md");

    assert.match(plan, /Do not enable RLS on public discovery tables/);
    assert.match(plan, /`Listing`/);
    assert.match(plan, /`SellerProfile`/);
    assert.match(plan, /`BlogPost`/);
    assert.match(plan, /`Review`/);
  });

  it("documents SavedBlogPost as direct-owner but wrapper-sensitive", () => {
    const plan = source("docs/rls-feasibility-plan.md");
    const defense = source("docs/db-defense-in-depth-plan.md");

    assert.match(plan, /SavedBlogPost Prototype Edge Cases/);
    assert.match(plan, /No public saved-post aggregate exists today/);
    assert.match(plan, /homepage blog cards/);
    assert.match(plan, /\/api\/account\/feed/);
    assert.match(plan, /parallel Prisma queries/);
    assert.match(defense, /blog index\/author\/detail saved-state reads/);
    assert.match(defense, /owner-only `SELECT` RLS/);
  });

  it("cross-links the RLS plan from the active audit docs", () => {
    const hardening = source("docs/security-hardening-plan.md");
    const auditLog = source("docs/security-audit-log.md");
    const claude = source("CLAUDE.md");

    assert.match(hardening, /docs\/rls-feasibility-plan\.md/);
    assert.match(auditLog, /docs\/rls-feasibility-plan\.md/);
    assert.match(claude, /docs\/rls-feasibility-plan\.md/);
  });
});
