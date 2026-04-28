"use client";
import { useRouter } from "next/navigation";
import { publicSellerShopPath } from "@/lib/publicPaths";

export default function SortSelect({
  currentSort,
  sellerId,
  sellerName,
  category,
}: {
  currentSort: string;
  sellerId: string;
  sellerName: string | null;
  category: string | null;
}) {
  const router = useRouter();

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    params.set("sort", e.target.value);
    router.push(`${publicSellerShopPath(sellerId, sellerName)}?${params.toString()}`);
  };

  return (
    <select
      value={currentSort}
      onChange={onChange}
      className="rounded border border-neutral-300 px-3 py-1.5 text-sm bg-white text-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-400 shrink-0"
      aria-label="Sort listings"
    >
      <option value="newest">Newest</option>
      <option value="price_asc">Price: Low to High</option>
      <option value="price_desc">Price: High to Low</option>
      <option value="popular">Most Popular</option>
    </select>
  );
}
