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
      className="h-8 shrink-0 rounded-full border border-neutral-200 bg-white px-2.5 pr-7 text-xs font-medium text-neutral-700 shadow-sm outline-none transition hover:bg-neutral-50 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
      aria-label="Sort listings"
    >
      <option value="newest">Newest</option>
      <option value="price_asc">Price: Low to High</option>
      <option value="price_desc">Price: High to Low</option>
      <option value="popular">Most Popular</option>
    </select>
  );
}
