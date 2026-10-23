import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const displayNameAtLimit = "🪵".repeat(100);
const displayNameOverLimit = "🪵".repeat(101);
const titleAtLimit = "🪵".repeat(150);
const titleOverLimit = "🪵".repeat(151);

function isTextWithinCodePointRange(value, minimum, maximum) {
  if (typeof value !== "string") return false;
  const length = Array.from(value).length;
  return length >= minimum && length <= maximum;
}

function loadTypeScriptModule(path, dependencies) {
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  const moduleRecord = { exports };
  vm.runInNewContext(javascript, {
    Array,
    BigInt,
    Date,
    Error,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RangeError,
    RegExp,
    Set,
    String,
    TypeError,
    exports,
    module: moduleRecord,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
      return dependencies[name];
    },
  }, { filename: path });
  return moduleRecord.exports;
}

function prismaSql(strings, ...values) {
  return { strings, values };
}

function commonDependencies(client) {
  return {
    "@/lib/db": { prisma: client },
    "@/lib/dbUserContext": {
      withDbUserContext: async (_userId, callback) => callback(client),
    },
    "@/lib/locationPrivacy": { isSupportedLocationPoint: () => true },
    "@/lib/textLength": { isTextWithinCodePointRange },
    "@prisma/client": { Prisma: { sql: prismaSql } },
  };
}

test("shared text bounds count Unicode code points instead of UTF-16 code units", async () => {
  const { codePointLength, isTextWithinCodePointRange: withinRange } = await import(
    "../src/lib/textLength.ts"
  );

  assert.equal(codePointLength(displayNameAtLimit), 100);
  assert.equal(codePointLength(displayNameOverLimit), 101);
  assert.equal(withinRange(displayNameAtLimit, 1, 100), true);
  assert.equal(withinRange(displayNameOverLimit, 1, 100), false);
  assert.equal(withinRange(null, 0, 100), false);
});

test("SellerProfile projections accept PostgreSQL varchar limits by Unicode code point", async () => {
  let publicRows = [{
    listingId: "listing_1",
    sellerProfileId: "seller_1",
    displayName: displayNameAtLimit,
    avatarImageUrl: null,
    guildLevel: "NONE",
    city: null,
    state: null,
    acceptingNewOrders: true,
    ownerImageUrl: null,
  }];
  const publicClient = { $queryRaw: async () => publicRows };
  const publicAccess = loadTypeScriptModule(
    "src/lib/sellerProfilePublicAccess.ts",
    commonDependencies(publicClient),
  );

  const cards = await publicAccess.sellerPublicListingCards(null, ["listing_1"]);
  assert.equal(cards[0].displayName, displayNameAtLimit);
  publicRows = [{ ...publicRows[0], displayName: displayNameOverLimit }];
  await assert.rejects(
    publicAccess.sellerPublicListingCards(null, ["listing_1"]),
    /invalid result/,
  );

  let ownerRows = [{
    sellerProfileId: "seller_1",
    displayName: displayNameAtLimit,
    createdAtEpochMillis: 0n,
    chargesEnabled: true,
    vacationMode: false,
  }];
  const ownerClient = { $queryRaw: async () => ownerRows };
  const ownerAccess = loadTypeScriptModule(
    "src/lib/sellerProfileOwnerAccess.ts",
    commonDependencies(ownerClient),
  );
  assert.equal((await ownerAccess.sellerOwnerCore("owner_1")).displayName, displayNameAtLimit);
  ownerRows = [{ ...ownerRows[0], displayName: displayNameOverLimit }];
  await assert.rejects(ownerAccess.sellerOwnerCore("owner_1"), /invalid result/);

  let transactionRows = [{
    id: "seller_1",
    userId: "owner_1",
    displayName: displayNameAtLimit,
    chargesEnabled: true,
    stripeAccountSupported: true,
    ownerAccountActive: true,
    vacationMode: false,
    acceptingNewOrders: true,
    freeShippingOverCents: null,
    shippingFlatRateCents: null,
    allowLocalPickup: true,
    offersGiftWrapping: false,
    giftWrappingPriceCents: null,
  }];
  const transactionClient = { $queryRaw: async () => transactionRows };
  const transactionAccess = loadTypeScriptModule(
    "src/lib/sellerTransactionAccess.ts",
    commonDependencies(transactionClient),
  );
  assert.equal(
    (await transactionAccess.readSellerActorListingTransactionState(
      transactionClient,
      "listing_1",
    )).displayName,
    displayNameAtLimit,
  );
  transactionRows = [{ ...transactionRows[0], displayName: displayNameOverLimit }];
  await assert.rejects(
    transactionAccess.readSellerActorListingTransactionState(transactionClient, "listing_1"),
    /invalid result/,
  );
});

test("SellerProfile listing projections accept 150-code-point titles", async () => {
  let rows = [{
    id: "listing_1",
    title: titleAtLimit,
    priceCents: 100,
    currency: "USD",
    photoUrl: null,
    sellerDisplayName: displayNameAtLimit,
    sellerAvatarImageUrl: null,
  }];
  const client = { $queryRaw: async () => rows };
  const access = loadTypeScriptModule(
    "src/lib/sellerProfilePublicAccess.ts",
    commonDependencies(client),
  );

  const listings = await access.sellerPublicRecentlyViewedListings(null, ["listing_1"]);
  assert.equal(listings[0].title, titleAtLimit);
  rows = [{ ...rows[0], title: titleOverLimit }];
  await assert.rejects(
    access.sellerPublicRecentlyViewedListings(null, ["listing_1"]),
    /invalid result/,
  );
});
