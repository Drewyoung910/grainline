import { revalidateTag, unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { publicListingWhere } from "@/lib/listingVisibility";
import { activeSellerProfileWhere } from "@/lib/sellerVisibility";

export const FOOTER_METROS_CACHE_TAG = "footer-metros";

export type FooterMetro = {
  slug: string;
  name: string;
  state: string;
  _count: { listings: number };
};

async function queryFooterMetros(): Promise<FooterMetro[]> {
  return prisma.metro.findMany({
    where: {
      isActive: true,
      OR: [
        {
          listings: {
            some: publicListingWhere(),
          },
        },
        {
          sellerProfiles: {
            some: activeSellerProfileWhere(),
          },
        },
      ],
    },
    select: { slug: true, name: true, state: true, _count: { select: { listings: true } } },
    orderBy: [{ listings: { _count: "desc" } }, { name: "asc" }, { slug: "asc" }],
    take: 10,
  });
}

export const getFooterMetros = unstable_cache(
  queryFooterMetros,
  ["footer-metros"],
  { revalidate: 300, tags: [FOOTER_METROS_CACHE_TAG] },
);

export function revalidateFooterMetrosCache() {
  revalidateTag(FOOTER_METROS_CACHE_TAG, "max");
}
