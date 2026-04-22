// src/app/listing/[id]/loading.tsx
export default function ListingLoading() {
  return (
    <main className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="h-4 w-28 bg-neutral-200 rounded animate-pulse" />
      <div className="grid md:grid-cols-2 gap-6">
        <div className="aspect-square w-full bg-neutral-200 rounded-2xl animate-pulse" />
        <div className="space-y-4">
          <div className="h-6 w-2/3 bg-neutral-200 rounded animate-pulse" />
          <div className="h-5 w-24 bg-neutral-200 rounded animate-pulse" />
          <div className="h-20 w-full bg-neutral-200 rounded animate-pulse" />
          <div className="h-4 w-40 bg-neutral-200 rounded animate-pulse" />
        </div>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-square bg-neutral-200 rounded-xl animate-pulse" />
        ))}
      </div>
    </main>
  );
}
