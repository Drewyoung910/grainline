import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type CartOwnerAccessClient = Pick<Prisma.TransactionClient, "cart" | "cartItem" | "$queryRaw">;

export function ownerCartWhere(userId: string, where: Prisma.CartWhereInput = {}): Prisma.CartWhereInput {
  return { AND: [{ userId }, where] };
}

export function ownerCartItemWhere(
  userId: string,
  where: Prisma.CartItemWhereInput = {},
): Prisma.CartItemWhereInput {
  return { AND: [{ cart: { userId } }, where] };
}

export async function ownerCartForDisplay(userId: string, db: CartOwnerAccessClient = prisma) {
  return db.cart.findUnique({
    where: { userId },
    include: {
      items: {
        include: {
          listing: {
            include: {
              photos: { take: 1, orderBy: { sortOrder: "asc" } },
              seller: {
                select: {
                  id: true,
                  displayName: true,
                  vacationMode: true,
                  chargesEnabled: true,
                  freeShippingOverCents: true,
                  shippingFlatRateCents: true,
                  allowLocalPickup: true,
                  offersGiftWrapping: true,
                  giftWrappingPriceCents: true,
                  user: {
                    select: {
                      banned: true,
                      deletedAt: true,
                    },
                  },
                },
              },
              variantGroups: { include: { options: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function upsertOwnerCart(userId: string, db: CartOwnerAccessClient = prisma) {
  return db.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function ownerCartByUserId(userId: string, db: CartOwnerAccessClient = prisma) {
  return db.cart.findUnique({ where: { userId } });
}

export async function lockOwnerCart(
  userId: string,
  cartId: string,
  db: CartOwnerAccessClient = prisma,
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
  db: CartOwnerAccessClient = prisma,
) {
  return db.cartItem.findFirst({
    where: ownerCartItemWhere(userId, { cartId, listingId, variantKey }),
    select: { quantity: true },
  });
}

export async function ownerCartItemStats(
  userId: string,
  cartId: string,
  db: CartOwnerAccessClient = prisma,
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
  db: CartOwnerAccessClient = prisma,
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
  db: CartOwnerAccessClient = prisma,
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
  db: CartOwnerAccessClient = prisma,
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
  db: CartOwnerAccessClient = prisma,
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
  db: CartOwnerAccessClient = prisma,
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
  db: CartOwnerAccessClient = prisma,
) {
  return db.cartItem.findFirst({
    where: ownerCartItemWhere(userId, { id: itemId, cartId }),
  });
}

export async function ownerCartItemsByListing(
  userId: string,
  cartId: string,
  listingId: string,
  db: CartOwnerAccessClient = prisma,
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
  db: CartOwnerAccessClient = prisma,
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
  db: CartOwnerAccessClient = prisma,
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
  db: CartOwnerAccessClient = prisma,
) {
  return db.cartItem.updateMany({
    where: ownerCartItemWhere(userId, { id: itemId, cartId }),
    data,
  });
}

export async function updateOwnerCartItemPrice(
  userId: string,
  cartId: string,
  itemId: string,
  data: Pick<Prisma.CartItemUpdateManyMutationInput, "priceCents" | "priceVersion">,
  db: CartOwnerAccessClient = prisma,
) {
  return db.cartItem.updateMany({
    where: ownerCartItemWhere(userId, { id: itemId, cartId }),
    data,
  });
}

export async function ownerCartForCheckoutSeller(
  userId: string,
  db: CartOwnerAccessClient = prisma,
) {
  return db.cart.findUnique({
    where: { userId },
    include: {
      items: {
        include: {
          listing: {
            include: {
              seller: { include: { user: { select: { banned: true, deletedAt: true } } } },
              photos: true,
              variantGroups: { include: { options: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function ownerCartForCheckoutResume(
  userId: string,
  db: CartOwnerAccessClient = prisma,
) {
  return db.cart.findUnique({
    where: { userId },
    select: {
      id: true,
      items: {
        select: {
          listing: {
            select: {
              sellerId: true,
              seller: { select: { displayName: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function ownerCartForShippingQuoteById(
  userId: string,
  cartId: string,
  sellerId: string | null | undefined,
  db: CartOwnerAccessClient = prisma,
) {
  return db.cart.findFirst({
    where: ownerCartWhere(userId, { id: cartId }),
    include: {
      items: {
        include: {
          listing: {
            include: {
              seller: { include: { user: { select: { banned: true, deletedAt: true } } } },
            },
          },
        },
        where: sellerId ? { listing: { sellerId } } : undefined,
      },
    },
  });
}

export async function ownerCartForShippingQuote(
  userId: string,
  sellerId: string | null | undefined,
  db: CartOwnerAccessClient = prisma,
) {
  return db.cart.findUnique({
    where: { userId },
    include: {
      items: {
        include: {
          listing: {
            include: {
              seller: { include: { user: { select: { banned: true, deletedAt: true } } } },
            },
          },
        },
        where: sellerId ? { listing: { sellerId } } : undefined,
      },
    },
  });
}

export async function ownerCartExportRows(userId: string, db: CartOwnerAccessClient = prisma) {
  return db.cart.findUnique({
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
  });
}
