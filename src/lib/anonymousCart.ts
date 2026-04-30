export const ANONYMOUS_CART_KEY = "grainline_anonymous_cart";

export type AnonymousCartSnapshot = {
  title: string;
  sellerId: string;
  sellerName: string;
  priceCents: number;
  imageUrl?: string | null;
  variantLabels?: string[];
  listingType?: string | null;
  currency?: string | null;
  maxQuantity?: number | null;
  offersGiftWrapping?: boolean | null;
  giftWrappingPriceCents?: number | null;
};

export type AnonymousCartItem = {
  lineKey: string;
  listingId: string;
  quantity: number;
  selectedVariantOptionIds: string[];
  addedAt: number;
  snapshot: AnonymousCartSnapshot;
};

export type AnonymousCartItemInput = {
  listingId: string;
  quantity?: number;
  selectedVariantOptionIds?: string[];
  snapshot: AnonymousCartSnapshot;
};

type CartStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const MAX_ANONYMOUS_CART_LINES = 100;
const MAX_CART_QUANTITY = 99;

function getBrowserStorage(): CartStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeQuantity(quantity: unknown): number {
  const value = Number(quantity);
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_CART_QUANTITY, Math.max(1, Math.floor(value)));
}

function normalizeVariantOptionIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.trim() !== "").map((id) => id.trim()))]
    .slice(0, 30)
    .sort();
}

function sanitizeSnapshot(snapshot: unknown): AnonymousCartSnapshot | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const data = snapshot as Record<string, unknown>;
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const sellerId = typeof data.sellerId === "string" ? data.sellerId.trim() : "";
  const sellerName = typeof data.sellerName === "string" ? data.sellerName.trim() : "";
  const priceCents = Number(data.priceCents);
  if (!title || !sellerId || !sellerName || !Number.isInteger(priceCents) || priceCents < 1) {
    return null;
  }

  const imageUrl = typeof data.imageUrl === "string" && data.imageUrl.trim() ? data.imageUrl.trim() : null;
  const variantLabels = Array.isArray(data.variantLabels)
    ? data.variantLabels.filter((label): label is string => typeof label === "string" && label.trim() !== "").slice(0, 30)
    : [];
  const listingType = typeof data.listingType === "string" ? data.listingType : null;
  const currency = typeof data.currency === "string" && data.currency.trim() ? data.currency.trim().toLowerCase() : "usd";
  const maxQuantity = Number.isInteger(data.maxQuantity) ? Math.max(0, Number(data.maxQuantity)) : null;
  const offersGiftWrapping = typeof data.offersGiftWrapping === "boolean" ? data.offersGiftWrapping : null;
  const giftWrappingPriceCents = Number.isInteger(data.giftWrappingPriceCents)
    ? Math.max(0, Number(data.giftWrappingPriceCents))
    : null;

  return {
    title,
    sellerId,
    sellerName,
    priceCents,
    imageUrl,
    variantLabels,
    listingType,
    currency,
    maxQuantity,
    offersGiftWrapping,
    giftWrappingPriceCents,
  };
}

export function anonymousCartLineKey(listingId: string, selectedVariantOptionIds: string[] = []): string {
  const variantKey = normalizeVariantOptionIds(selectedVariantOptionIds).join(",");
  return `${listingId}:${variantKey}`;
}

export function readAnonymousCartItems(storage: CartStorage | null = getBrowserStorage()): AnonymousCartItem[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(ANONYMOUS_CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): AnonymousCartItem[] => {
      if (!item || typeof item !== "object") return [];
      const data = item as Record<string, unknown>;
      const listingId = typeof data.listingId === "string" ? data.listingId.trim() : "";
      if (!listingId) return [];
      const selectedVariantOptionIds = normalizeVariantOptionIds(data.selectedVariantOptionIds);
      const snapshot = sanitizeSnapshot(data.snapshot);
      if (!snapshot) return [];
      return [{
        lineKey: anonymousCartLineKey(listingId, selectedVariantOptionIds),
        listingId,
        quantity: normalizeQuantity(data.quantity),
        selectedVariantOptionIds,
        addedAt: Number.isFinite(Number(data.addedAt)) ? Number(data.addedAt) : Date.now(),
        snapshot,
      }];
    }).slice(0, MAX_ANONYMOUS_CART_LINES);
  } catch {
    return [];
  }
}

export function writeAnonymousCartItems(
  items: AnonymousCartItem[],
  storage: CartStorage | null = getBrowserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(ANONYMOUS_CART_KEY, JSON.stringify(items.slice(0, MAX_ANONYMOUS_CART_LINES)));
    return true;
  } catch {
    return false;
  }
}

export function clearAnonymousCart(storage: CartStorage | null = getBrowserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(ANONYMOUS_CART_KEY);
    return true;
  } catch {
    return false;
  }
}

export function addAnonymousCartItem(
  input: AnonymousCartItemInput,
  storage: CartStorage | null = getBrowserStorage(),
): { ok: boolean; items: AnonymousCartItem[]; item: AnonymousCartItem | null } {
  const snapshot = sanitizeSnapshot(input.snapshot);
  if (!snapshot || !input.listingId.trim()) {
    const items = readAnonymousCartItems(storage);
    return { ok: false, items, item: null };
  }

  const selectedVariantOptionIds = normalizeVariantOptionIds(input.selectedVariantOptionIds);
  const lineKey = anonymousCartLineKey(input.listingId, selectedVariantOptionIds);
  const items = readAnonymousCartItems(storage);
  const existing = items.find((item) => item.lineKey === lineKey);
  const quantityToAdd = normalizeQuantity(input.quantity ?? 1);
  const nextQuantity = snapshot.listingType === "MADE_TO_ORDER"
    ? 1
    : Math.min(MAX_CART_QUANTITY, (existing?.quantity ?? 0) + quantityToAdd);

  const nextItem: AnonymousCartItem = {
    lineKey,
    listingId: input.listingId.trim(),
    quantity: nextQuantity,
    selectedVariantOptionIds,
    addedAt: existing?.addedAt ?? Date.now(),
    snapshot,
  };
  const nextItems = existing
    ? items.map((item) => (item.lineKey === lineKey ? nextItem : item))
    : [...items, nextItem].slice(0, MAX_ANONYMOUS_CART_LINES);
  const ok = writeAnonymousCartItems(nextItems, storage);
  return { ok, items: ok ? nextItems : items, item: ok ? nextItem : null };
}

export function updateAnonymousCartItem(
  lineKey: string,
  quantity: number,
  storage: CartStorage | null = getBrowserStorage(),
): { ok: boolean; items: AnonymousCartItem[] } {
  const items = readAnonymousCartItems(storage);
  const nextItems = quantity <= 0
    ? items.filter((item) => item.lineKey !== lineKey)
    : items.map((item) => {
        if (item.lineKey !== lineKey) return item;
        const nextQuantity = item.snapshot.listingType === "MADE_TO_ORDER" ? 1 : normalizeQuantity(quantity);
        return { ...item, quantity: nextQuantity };
      });
  const ok = writeAnonymousCartItems(nextItems, storage);
  return { ok, items: ok ? nextItems : items };
}

export function anonymousCartCount(storage: CartStorage | null = getBrowserStorage()): number {
  return readAnonymousCartItems(storage).reduce((sum, item) => sum + item.quantity, 0);
}
