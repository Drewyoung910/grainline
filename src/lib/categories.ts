import type { Category } from "@prisma/client";

export const CATEGORY_LABELS: Record<string, string> = {
  FURNITURE: "Furniture",
  KITCHEN: "Kitchen & Dining",
  DECOR: "Decor",
  TOOLS: "Home & Office",
  TOYS: "Toys",
  JEWELRY: "Jewelry",
  ART: "Art",
  OUTDOOR: "Outdoor",
  STORAGE: "Gifts",
  OTHER: "Other",
} as const satisfies Record<Category, string>;

export const CATEGORY_VALUES = Object.keys(CATEGORY_LABELS);
