// src/app/listing/[id]/loading.tsx
export default function ListingLoading() {
  return (
    <main className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <div className="h-4 w-28 bg-neutral-200 rounded animate-pulse" />
      <div className="grid md:grid-cols-2 gap-6">
        <div className="rounded-2xl bg-neutral-200 aspect-square animate-pulse" />
        <div className="space-y-4">
          <div className="h-6 w-2/3 bg-neutral-200 rounded animate-pulse" />
          <div className="h-5 w-24 bg-neutral-200 rounded animate-pulse" />
          <div className="h-20 w-full bg-neutral-200 rounded animate-pulse" />
          <div className="h-4 w-40 bg-neutral-200 rounded animate-pulse" />
        </div>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl bg-neutral-200 aspect-square animate-pulse" />
        ))}
      </div>
    </main>
  );
}
