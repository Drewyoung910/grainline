import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  type DbUserContextTransactionClient,
  withDbUserContext,
} from "@/lib/dbUserContext";
import {
  attachCartSellerStates,
  withSellerActorCartTransaction,
} from "@/lib/sellerTransactionAccess";

export type CartOwnerAccessClient = Pick<
  DbUserContextTransactionClient,
  "cart" | "cartItem" | "$executeRaw" | "$queryRaw"
>;

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
  return withSellerActorCartTransaction(userId, async (db, sellerStates) => {
    const cart = await db.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            listing: {
              include: {
                photos: { take: 1, orderBy: { sortOrder: "asc" } },
                variantGroups: { include: { options: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!cart) return null;
    return {
      ...cart,
      items: attachCartSellerStates(cart.items, await sellerStates(cart.id)),
    };
  });
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
    include: { listing: true },
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

export async function findOwnerCartItemByVariantWithListing(
  userId: string,
  cartId: string,
  listingId: string,
  variantKey: string,
  db: CartOwnerAccessClient,
) {
  return db.cartItem.findFirst({
    where: ownerCartItemWhere(userId, { cartId, listingId, variantKey }),
    include: { listing: true },
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
  return withSellerActorCartTransaction(userId, async (db, sellerStates) => {
    const cart = await db.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            listing: {
              include: {
                photos: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
                variantGroups: { include: { options: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!cart) return null;
    return {
      ...cart,
      items: attachCartSellerStates(cart.items, await sellerStates(cart.id)),
    };
  });
}

export async function ownerCartForCheckoutResume(
  userId: string,
) {
  return withSellerActorCartTransaction(userId, async (db, sellerStates) => {
    const cart = await db.cart.findUnique({
      where: { userId },
      select: {
        id: true,
        items: {
          select: {
            listing: { select: { sellerId: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!cart) return null;
    return {
      ...cart,
      items: attachCartSellerStates(cart.items, await sellerStates(cart.id)),
    };
  });
}

export async function ownerCartForShippingQuoteById(
  userId: string,
  cartId: string,
  sellerId: string | null | undefined,
) {
  return withSellerActorCartTransaction(userId, async (db, sellerStates) => {
    const cart = await db.cart.findFirst({
      where: ownerCartWhere(userId, { id: cartId }),
      include: {
        items: {
          include: { listing: true },
          where: sellerId ? { listing: { sellerId } } : undefined,
        },
      },
    });
    if (!cart) return null;
    return {
      ...cart,
      items: attachCartSellerStates(cart.items, await sellerStates(cart.id)),
    };
  });
}

export async function ownerCartForShippingQuote(
  userId: string,
  sellerId: string | null | undefined,
) {
  return withSellerActorCartTransaction(userId, async (db, sellerStates) => {
    const cart = await db.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: { listing: true },
          where: sellerId ? { listing: { sellerId } } : undefined,
        },
      },
    });
    if (!cart) return null;
    return {
      ...cart,
      items: attachCartSellerStates(cart.items, await sellerStates(cart.id)),
    };
  });
}

export function ownerCartExportRows(userId: string) {
  return withDbUserContext(userId, (db) =>
    db.cart.findUnique({
      where: { userId },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        items: {
          select: {
            listingId: true,
            quantity: true,
            priceCents: true,
            selectedVariantOptionIds: true,
            variantKey: true,
            createdAt: true,
            listing: { select: { title: true } },
          },
        },
      },
    }),
  );
}
