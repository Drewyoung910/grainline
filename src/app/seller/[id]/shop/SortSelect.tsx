"use client";
import { useRouter } from "next/navigation";
import { publicSellerShopPath } from "@/lib/publicPaths";

export default function SortSelect({
  currentSort,
  sellerId,
  sellerName,
  category,
  tag,
  status,
}: {
  currentSort: string;
  sellerId: string;
  sellerName: string | null;
  category: string | null;
  tag: string | null;
  status: string | null;
}) {
  const router = useRouter();

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (tag) params.set("tag", tag);
    if (status) params.set("status", status);
    params.set("sort", e.target.value);
    router.push(`${publicSellerShopPath(sellerId, sellerName)}?${params.toString()}`);
  };

  return (
    <select
      value={currentSort}
      onChange={onChange}
      className="h-9 shrink-0 rounded-full border border-neutral-200 bg-white px-3 pr-8 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
      aria-label="Sort listings"
    >
      <option value="newest">Newest</option>
      <option value="price_asc">Price: Low to High</option>
      <option value="price_desc">Price: High to Low</option>
      <option value="popular">Most Popular</option>
    </select>
  );
}
