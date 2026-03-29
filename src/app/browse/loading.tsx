// src/app/browse/loading.tsx
export default function BrowseLoading() {
  return (
    <main className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-end justify-between">
        <div className="h-7 w-32 rounded bg-neutral-200 animate-pulse" />
        <div className="h-4 w-20 rounded bg-neutral-200 animate-pulse" />
      </header>

      <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {Array.from({ length: 9 }).map((_, i) => (
          <li key={i} className="border rounded-xl overflow-hidden">
            <div className="h-48 w-full bg-neutral-200 animate-pulse" />
            <div className="p-4 space-y-3">
              <div className="h-4 w-2/3 bg-neutral-200 rounded animate-pulse" />
              <div className="h-4 w-1/3 bg-neutral-200 rounded animate-pulse" />
              <div className="h-6 w-40 bg-neutral-200 rounded-full animate-pulse" />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
