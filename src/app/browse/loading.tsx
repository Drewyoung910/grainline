// Skeleton for /browse — mirrors the live layout: mobile filter bar,
// sidebar on desktop, listings grid.
export default function BrowseLoading() {
  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto" aria-busy="true" aria-label="Loading">
      {/* Mobile filter buttons */}
      <div className="md:hidden flex items-center gap-3 pb-3 mb-3 border-b border-neutral-200">
        <div className="h-11 w-28 rounded-md bg-[#EFEAE0] animate-pulse" />
        <div className="h-11 w-32 rounded-md bg-[#EFEAE0] animate-pulse" />
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:gap-8">
        {/* Sidebar (desktop only) */}
        <aside className="hidden md:block md:w-64 shrink-0 space-y-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 w-24 rounded bg-[#EFEAE0] animate-pulse" />
              <div className="h-9 w-full rounded-md bg-[#EFEAE0] animate-pulse" />
              {i === 0 && <div className="h-9 w-full rounded-md bg-[#EFEAE0] animate-pulse" />}
            </div>
          ))}
        </aside>

        {/* Listings grid */}
        <div className="flex-1 min-w-0">
          <header className="mb-6 flex items-center justify-between">
            <div className="h-8 w-40 rounded-md bg-[#EFEAE0] animate-pulse" />
            <div className="h-4 w-28 rounded bg-[#EFEAE0] animate-pulse" />
          </header>

          <ul className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-3 gap-y-6 sm:gap-x-4 sm:gap-y-8">
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i}>
                <div className="rounded-2xl bg-[#EFEAE0] aspect-[4/5] animate-pulse" />
                <div className="mt-3 space-y-2 px-1">
                  <div className="h-4 w-3/4 rounded bg-[#EFEAE0] animate-pulse" />
                  <div className="h-4 w-1/3 rounded bg-[#EFEAE0] animate-pulse" />
                  <div className="h-3 w-1/2 rounded bg-[#EFEAE0] animate-pulse" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
