// src/app/browse/loading.tsx
export default function BrowseLoading() {
  return (
    <main className="p-4 sm:p-6 max-w-7xl mx-auto">
      <header className="mb-6 flex items-end justify-between">
        <div className="h-7 w-32 rounded bg-neutral-200 animate-pulse" />
        <div className="h-4 w-20 rounded bg-neutral-200 animate-pulse" />
      </header>

      <ul className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <li key={i}>
            <div className="rounded-2xl bg-neutral-200 aspect-square animate-pulse" />
            <div className="mt-3 space-y-2 px-1">
              <div className="h-4 w-3/4 bg-neutral-200 rounded animate-pulse" />
              <div className="h-4 w-1/3 bg-neutral-200 rounded animate-pulse" />
              <div className="h-3 w-1/2 bg-neutral-200 rounded animate-pulse" />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
