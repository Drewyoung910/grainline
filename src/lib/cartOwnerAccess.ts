import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  type DbUserContextTransactionClient,
  withDbUserContext,
} from "@/lib/dbUserContext";
import {
  readListingActorCartTransactionSources,
} from "@/lib/sellerTransactionAccess";

export type CartOwnerAccessClient = Pick<
  DbUserContextTransactionClient,
  "cart" | "cartItem" | "$executeRaw" | "$queryRaw"
>;

const ownerCartReadOptions = {
  isolationLevel: "RepeatableRead" as const,
};

async function attachOwnerCartListingSources<
  T extends { id: string; listingId: string },
>(
  db: Pick<DbUserContextTransactionClient, "$queryRaw">,
  cartId: string,
  items: ReadonlyArray<T>,
) {
  const sources = await readListingActorCartTransactionSources(db, cartId);
  if (sources.length !== items.length) {
    throw new Error("Listing cart transaction authority omitted a cart item");
  }
  const byCartItemId = new Map(sources.map((source) => [source.cartItemId, source.listing]));
  return items.map((item) => {
    const listing = byCartItemId.get(item.id);
    if (!listing || listing.id !== item.listingId) {
      throw new Error("Listing cart transaction authority returned a mismatched cart item");
    }
    return { ...item, listing };
  });
}

export function withOwnerCartTransaction<T>(
  userId: string,
  operation: (db: DbUserContextTransactionClient) => Promise<T>,
) {
  return withDbUserContext(userId, operation);
}

export function ownerCartWhere(userId: string, where: Prisma.CartWhereInput = {}): Prisma.CartWhereInput {
  return { AND: [{ userId }, where] };
}

export function ownerCartItemWhere(
  userId: string,
  where: Prisma.CartItemWhereInput = {},
): Prisma.CartItemWhereInput {
  return { AND: [{ cart: { userId } }, where] };
}

export async function ownerCartForDisplay(userId: string) {
  return withDbUserContext(userId, async (db) => {
    const cart = await db.cart.findUnique({
      where: { userId },
      include: {
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!cart) return null;
    const items = await attachOwnerCartListingSources(db, cart.id, cart.items);
    return {
      ...cart,
      items: items.map((item) => ({
        ...item,
        listing: {
          ...item.listing,
          photos: item.listing.photos.slice(0, 1),
        },
      })),
    };
  }, ownerCartReadOptions);
}

export async function upsertOwnerCart(userId: string, db: CartOwnerAccessClient) {
  const cartId = randomUUID();
  await db.$executeRaw`
    INSERT INTO public."Cart" (id, "userId", "createdAt", "updatedAt")
    VALUES (${cartId}, ${userId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("userId") DO NOTHING
  `;
  const cart = await db.cart.findUnique({ where: { userId } });
  if (!cart) throw new Error("Cart could not be created");
  return cart;
}

export async function ownerCartByUserId(userId: string, db: CartOwnerAccessClient) {
  return db.cart.findUnique({ where: { userId } });
}

export async function lockOwnerCart(
  userId: string,
  cartId: string,
  db: CartOwnerAccessClient,
) {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Cart" WHERE id = ${cartId} AND "userId" = ${userId} FOR UPDATE
  `;
  if (rows.length !== 1) throw new Error("Cart not found");
}

export async function findOwnerCartItemByVariant(
  userId: string,
  cartId: string,
  listingId: string,
  variantKey: string,
  db: CartOwnerAccessClient,
) {
  return db.cartItem.findFirst({
    where: ownerCartItemWhere(userId, { cartId, listingId, variantKey }),
    select: { quantity: true },
  });
}

export async function ownerCartItemStats(
  userId: string,
  cartId: string,
  db: CartOwnerAccessClient,
) {
  return db.cartItem.aggregate({
    where: ownerCartItemWhere(userId, { cartId }),
    _count: { id: true },
    _sum: { quantity: true },
  });
}

export async function ownerCartItemQuantityStats(
  userId: string,
  cartId: string,
  db: CartOwnerAccessClient,
) {
  return db.cartItem.aggregate({
    where: ownerCartItemWhere(userId, { cartId }),
    _sum: { quantity: true },
  });
}

export async function createOwnerCartItem(
  userId: string,
  cartId: string,
  data: Omit<Prisma.CartItemUncheckedCreateInput, "cartId">,
  db: CartOwnerAccessClient,
) {
  await lockOwnerCart(userId, cartId, db);
  return db.cartItem.create({
    data: { ...data, cartId },
  });
}

export async function markOwnerCartItemMadeToOrder(
  userId: string,
  cartId: string,
  listingId: string,
  variantKey: string,
  data: Prisma.CartItemUpdateManyMutationInput,
  db: CartOwnerAccessClient,
) {
  return db.cartItem.updateMany({
    where: ownerCartItemWhere(userId, { cartId, listingId, variantKey }),
    data,
  });
}

export async function incrementOwnerCartItemQuantity(
  userId: string,
  cartId: string,
  listingId: string,
  variantKey: string,
  quantity: number,
  data: Omit<Prisma.CartItemUpdateManyMutationInput, "quantity">,
  db: CartOwnerAccessClient,
) {
  return db.cartItem.updateMany({
    where: ownerCartItemWhere(userId, {
      cartId,
      listingId,
      variantKey,
      quantity: { lte: 99 - quantity },
    }),
    data: {
      ...data,
      quantity: { increment: quantity },
    },
  });
}

export async function findOwnerCartItemByVariantState(
  userId: string,
  cartId: string,
  listingId: string,
  variantKey: string,
  db: CartOwnerAccessClient,
) {
  return db.cartItem.findFirst({
    where: ownerCartItemWhere(userId, { cartId, listingId, variantKey }),
  });
}

export async function findOwnerCartItemById(
  userId: string,
  cartId: string,
  itemId: string,
  db: CartOwnerAccessClient,
) {
  return db.cartItem.findFirst({
    where: ownerCartItemWhere(userId, { id: itemId, cartId }),
  });
}

export async function ownerCartItemsByListing(
  userId: string,
  cartId: string,
  listingId: string,
  db: CartOwnerAccessClient,
) {
  return db.cartItem.findMany({
    where: ownerCartItemWhere(userId, { cartId, listingId }),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 2,
  });
}

export async function lockOwnerCartItem(
  userId: string,
  cartId: string,
  itemId: string,
  db: CartOwnerAccessClient,
) {
  return db.cartItem.findFirst({
    where: ownerCartItemWhere(userId, { id: itemId, cartId }),
    select: { id: true, cartId: true, quantity: true },
  });
}

export async function deleteOwnerCartItem(
  userId: string,
  cartId: string,
  itemId: string,
  db: CartOwnerAccessClient,
) {
  return db.cartItem.deleteMany({
    where: ownerCartItemWhere(userId, { id: itemId, cartId }),
  });
}

export async function updateOwnerCartItemQuantity(
  userId: string,
  cartId: string,
  itemId: string,
  data: Prisma.CartItemUpdateManyMutationInput,
  db: CartOwnerAccessClient,
) {
  return db.cartItem.updateMany({
    where: ownerCartItemWhere(userId, { id: itemId, cartId }),
    data,
  });
}

async function updateOwnerCartItemPriceWithClient(
  userId: string,
  cartId: string,
  itemId: string,
  data: Pick<Prisma.CartItemUpdateManyMutationInput, "priceCents" | "priceVersion">,
  db: CartOwnerAccessClient,
) {
  return db.cartItem.updateMany({
    where: ownerCartItemWhere(userId, { id: itemId, cartId }),
    data,
  });
}

export function updateOwnerCartItemPrice(
  userId: string,
  cartId: string,
  itemId: string,
  data: Pick<Prisma.CartItemUpdateManyMutationInput, "priceCents" | "priceVersion">,
) {
  return withDbUserContext(userId, (db) =>
    updateOwnerCartItemPriceWithClient(userId, cartId, itemId, data, db),
  );
}

export async function ownerCartForCheckoutSeller(
  userId: string,
) {
  return withDbUserContext(userId, async (db) => {
    const cart = await db.cart.findUnique({
      where: { userId },
      include: {
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!cart) return null;
    return {
      ...cart,
      items: await attachOwnerCartListingSources(db, cart.id, cart.items),
    };
  }, ownerCartReadOptions);
}

export async function ownerCartForCheckoutResume(
  userId: string,
) {
  return withDbUserContext(userId, async (db) => {
    const cart = await db.cart.findUnique({
      where: { userId },
      select: {
        id: true,
        items: {
          select: { id: true, listingId: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!cart) return null;
    return {
      ...cart,
      items: await attachOwnerCartListingSources(db, cart.id, cart.items),
    };
  }, ownerCartReadOptions);
}

export async function ownerCartForShippingQuoteById(
  userId: string,
  cartId: string,
  sellerId: string | null | undefined,
) {
  return withDbUserContext(userId, async (db) => {
    const cart = await db.cart.findFirst({
      where: ownerCartWhere(userId, { id: cartId }),
      include: {
        items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    });
    if (!cart) return null;
    const items = await attachOwnerCartListingSources(db, cart.id, cart.items);
    return {
      ...cart,
      items: sellerId ? items.filter((item) => item.listing.sellerId === sellerId) : items,
    };
  }, ownerCartReadOptions);
}

export async function ownerCartForShippingQuote(
  userId: string,
  sellerId: string | null | undefined,
) {
  return withDbUserContext(userId, async (db) => {
    const cart = await db.cart.findUnique({
      where: { userId },
      include: {
        items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    });
    if (!cart) return null;
    const items = await attachOwnerCartListingSources(db, cart.id, cart.items);
    return {
      ...cart,
      items: sellerId ? items.filter((item) => item.listing.sellerId === sellerId) : items,
    };
  }, ownerCartReadOptions);
}

export function ownerCartExportRows(userId: string) {
  return withDbUserContext(userId, async (db) => {
    const cart = await db.cart.findUnique({
      where: { userId },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        items: {
          select: {
            id: true,
            listingId: true,
            quantity: true,
            priceCents: true,
            selectedVariantOptionIds: true,
            variantKey: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!cart) return null;
    const items = await attachOwnerCartListingSources(db, cart.id, cart.items);
    return {
      id: cart.id,
      createdAt: cart.createdAt,
      updatedAt: cart.updatedAt,
      items: items.map(({ id: _id, listing, ...item }) => ({
        ...item,
        listing: { title: listing.title },
      })),
    };
  }, ownerCartReadOptions);
}
