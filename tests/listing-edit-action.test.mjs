import assert from "node:assert/strict";
import test from "node:test";
import { ListingStatus } from "@prisma/client";
import * as formJson from "../src/lib/formJson.ts";
import * as fulfillmentDays from "../src/lib/listingFulfillmentDays.ts";
import * as editState from "../src/lib/listingEditState.ts";
import * as listingPrice from "../src/lib/listingPrice.ts";
import * as stockMutation from "../src/lib/listingStockMutation.ts";
import * as listingVariants from "../src/lib/listingVariants.ts";
import * as money from "../src/lib/money.ts";
import * as sanitize from "../src/lib/sanitize.ts";
import { loadWithStubs } from "./helpers/load-with-stubs.mjs";

function findAction(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findAction(child);
      if (found) return found;
    }
    return null;
  }
  if (typeof node.props?.action === "function") return node.props.action;
  return findAction(node.props?.children);
}

function formWith(fields) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

async function loadEditAction({ listing, currentStock = listing.stockQuantity, aiApproved = true, stock = {} }) {
  const statusWrites = [];
  const client = {
    listing: { update: async () => ({ title: listing.title, updatedAt: new Date(0) }) },
    listingVariantGroup: { deleteMany: async () => ({}), create: async () => ({}) },
    photo: { deleteMany: async () => ({}), updateMany: async () => ({ count: 1 }), create: async () => ({}) },
  };
  const prisma = {
    $transaction: (fn) => fn(client),
    photo: { findMany: async () => [] },
    listing: {
      findFirst: async () => listing,
      findUnique: async () => ({ status: listing.status, title: listing.title }),
      findUniqueOrThrow: async () => ({ listingType: listing.listingType, stockQuantity: currentStock, isPrivate: listing.isPrivate }),
      updateMany: async (write) => { statusWrites.push(write); return { count: 1 }; },
    },
  };
  const page = loadWithStubs("src/app/dashboard/listings/[id]/edit/page.tsx", {
    "@prisma/client": { ListingStatus },
    "next/navigation": {
      notFound: () => { throw new Error("not found"); },
      redirect: (path) => { throw new Error(`redirect:${path}`); },
    },
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk-1" }) },
    "@/lib/db": { prisma },
    "@/lib/ratelimit": { safeRateLimit: async () => ({ success: true }) },
    "@/lib/userIdentityAccess": { userClerkGate: async () => ({ id: "user-1", banned: false, deletedAt: null }) },
    "@/lib/sellerProfileOwnerAccess": {
      sellerOwnerCore: async () => ({ sellerProfileId: "seller-1", chargesEnabled: true, displayName: "Oak Shop" }),
      sellerOwnerListingReview: async () => ({ sellerProfileId: "seller-1", totalListingCount: 3 }),
    },
    "@/lib/formJson": formJson,
    "@/lib/listingEditState": editState,
    "@/lib/listingFulfillmentDays": fulfillmentDays,
    "@/lib/listingPrice": listingPrice,
    "@/lib/listingStockMutation": { ...stockMutation, lockListingStock: async () => listing, ...stock },
    "@/lib/listingVariants": listingVariants,
    "@/lib/money": money,
    "@/lib/sanitize": sanitize,
    "@/lib/categories": { CATEGORY_VALUES: [] },
    "@/lib/stockMutationState": { MAX_MANUAL_STOCK_QUANTITY: 9999 },
    "@/lib/photoAltTextBackfill": { backfillEmptyAltTexts: async () => {} },
    "@/lib/publicPaths": { publicListingPath: (id) => `/listing/${id}` },
    "@/lib/ai-review": {
      reviewListingWithAI: async () => ({ approved: aiApproved, flags: [], confidence: 0.99, reason: "", altTexts: [] }),
    },
  });
  const tree = await page.default({ params: Promise.resolve({ id: listing.id }), searchParams: Promise.resolve({}) });
  return { action: findAction(tree), statusWrites };
}

const baseListing = {
  id: "listing-1",
  sellerId: "seller-1",
  title: "Walnut desk",
  description: "A desk",
  priceCents: 10_000,
  currency: "usd",
  status: ListingStatus.DRAFT,
  isPrivate: false,
  archivedAt: null,
  rejectionReason: null,
  listingType: "MADE_TO_ORDER",
  stockQuantity: null,
  tags: [],
  materials: [],
  photos: [],
  variantGroups: [],
};

const validForm = { title: "Walnut desk", description: "A desk", price: "100", listingType: "MADE_TO_ORDER" };

test("a private custom listing with no photos can be saved, because photos are optional for it", async () => {
  const { action } = await loadEditAction({ listing: { ...baseListing, isPrivate: true } });
  await assert.rejects(action(null, formWith(validForm)), /redirect:\/dashboard\/listings\/listing-1\/edit\?saved=1/);
});

test("a public listing still needs a photo", async () => {
  const { action } = await loadEditAction({ listing: baseListing });
  const result = await action(null, formWith(validForm));
  assert.equal(result.ok, false);
  assert.match(result.error, /photo/);
});

const soldOutInStock = {
  ...baseListing,
  status: ListingStatus.SOLD_OUT,
  listingType: "IN_STOCK",
  stockQuantity: 0,
  photos: [{ id: "photo-1", url: "https://cdn.example/a.jpg", originalUrl: null, altText: null }],
};
const inStockForm = { ...validForm, listingType: "IN_STOCK", stockQuantity: "0" };

test("stock restored while the AI reviews an edit brings the listing back to ACTIVE", async () => {
  const { action, statusWrites } = await loadEditAction({ listing: soldOutInStock, currentStock: 1 });
  await assert.rejects(action(null, formWith(inStockForm)), /redirect:/);
  assert.equal(statusWrites.length, 1);
  assert.equal(statusWrites[0].data.status, ListingStatus.ACTIVE);
  assert.equal(statusWrites[0].where.stockQuantity, 1);
});

test("an approved edit keeps a listing with no stock sold out", async () => {
  const { action, statusWrites } = await loadEditAction({ listing: soldOutInStock, currentStock: 0 });
  await assert.rejects(action(null, formWith(inStockForm)), /redirect:/);
  assert.equal(statusWrites[0].data.status, ListingStatus.SOLD_OUT);
});

test("an active listing whose stock ran out during review comes back sold out", async () => {
  const { action, statusWrites } = await loadEditAction({
    listing: { ...soldOutInStock, status: ListingStatus.ACTIVE, stockQuantity: 1 },
    currentStock: 0,
  });
  await assert.rejects(action(null, formWith(inStockForm)), /redirect:/);
  assert.equal(statusWrites[0].data.status, ListingStatus.SOLD_OUT);
});

test("a sold-out private custom listing is not reopened by restored stock", async () => {
  const { action, statusWrites } = await loadEditAction({
    listing: { ...soldOutInStock, isPrivate: true },
    currentStock: 1,
  });
  await assert.rejects(action(null, formWith(inStockForm)), /redirect:/);
  assert.equal(statusWrites[0].data.status, ListingStatus.SOLD_OUT);
});

test("an edit page left open too long says to reload, not to check the device clock", async () => {
  const { action } = await loadEditAction({
    listing: { ...baseListing, photos: soldOutInStock.photos },
    stock: {
      prepareListingStockMutation: async () => {
        throw new stockMutation.StockMutationExpired("mutation-1", 0);
      },
    },
  });
  const result = await action(null, formWith({ ...validForm, listingType: "IN_STOCK", stockQuantity: "3" }));
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error, /clock/);
  assert.match(result.error, /[Rr]eload/);
});

test("saving a live listing lands on its page with a saved confirmation", async () => {
  const { action } = await loadEditAction({
    listing: { ...soldOutInStock, status: ListingStatus.ACTIVE, stockQuantity: 2 },
    currentStock: 2,
  });
  await assert.rejects(action(null, formWith(inStockForm)), /redirect:\/listing\/listing-1\?saved=1/);
});
