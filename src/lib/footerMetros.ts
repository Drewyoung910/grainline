import { revalidateTag, unstable_cache } from "next/cache";
import {
  sellerPublicFooterMetros,
  type SellerPublicFooterMetro,
} from "@/lib/sellerProfilePublicAccess";

export const FOOTER_METROS_CACHE_TAG = "footer-metros";

export type FooterMetro = SellerPublicFooterMetro;

async function queryFooterMetros(): Promise<FooterMetro[]> {
  return [...await sellerPublicFooterMetros()];
}

export const getFooterMetros = unstable_cache(
  queryFooterMetros,
  ["footer-metros"],
  { revalidate: 300, tags: [FOOTER_METROS_CACHE_TAG] },
);

export function revalidateFooterMetrosCache() {
  revalidateTag(FOOTER_METROS_CACHE_TAG, "max");
}
