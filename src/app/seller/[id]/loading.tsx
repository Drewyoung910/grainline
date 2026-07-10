// Skeleton for /seller/[id]. Mirrors the actual rhythm: banner with
// overlapping avatar, then identity row with CTAs, then stat band, then
// content sections. All placeholders use the dark-cream palette for
// consistency with the live page.
export default function SellerLoading() {
  return (
    <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading">
      {/* Banner with overlapping avatar */}
      <div className="relative aspect-[3/1] mt-4">
        <div className="absolute inset-0 rounded-2xl bg-[#EFEAE0] animate-pulse" />
        <div className="absolute bottom-0 left-6 sm:left-8 h-24 w-24 translate-y-1/2 rounded-full bg-[#E3DCCB] ring-4 ring-[#F7F5F0] shadow-sm animate-pulse" />
      </div>

      {/* Identity area */}
      <div className="px-2 sm:px-4 pt-16 pb-2 space-y-4">
        {/* Name row */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-2 flex-1 min-w-0">
            <div className="h-8 w-64 max-w-full rounded-md bg-[#EFEAE0] animate-pulse" />
            <div className="h-4 w-48 max-w-full rounded bg-[#EFEAE0] animate-pulse" />
          </div>
          <div className="h-4 w-32 rounded bg-[#EFEAE0] animate-pulse" />
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-2">
          <div className="h-5 w-32 rounded bg-[#EFEAE0] animate-pulse" />
          <div className="h-5 w-24 rounded bg-[#EFEAE0] animate-pulse" />
          <div className="h-5 w-28 rounded bg-[#EFEAE0] animate-pulse" />
          <div className="h-5 w-36 rounded bg-[#EFEAE0] animate-pulse" />
        </div>

        {/* Bio paragraph */}
        <div className="space-y-2 max-w-2xl">
          <div className="h-4 w-full rounded bg-[#EFEAE0] animate-pulse" />
          <div className="h-4 w-11/12 rounded bg-[#EFEAE0] animate-pulse" />
          <div className="h-4 w-3/4 rounded bg-[#EFEAE0] animate-pulse" />
        </div>

        {/* Action row */}
        <div className="flex flex-wrap gap-2 pt-1">
          <div className="h-9 w-28 rounded-md bg-[#EFEAE0] animate-pulse" />
          <div className="h-9 w-24 rounded-md bg-[#EFEAE0] animate-pulse" />
          <div className="h-9 w-44 rounded-md bg-[#EFEAE0] animate-pulse" />
          <div className="h-9 w-32 rounded-md bg-[#EFEAE0] animate-pulse" />
        </div>
      </div>

      {/* Body */}
      <div className="mt-6 pb-12 px-2 sm:px-4 space-y-10">
        {/* Featured Work header + grid */}
        <section>
          <div className="h-7 w-40 rounded-md bg-[#EFEAE0] animate-pulse mb-4" />
          <div className="grid grid-cols-1 lg:grid-cols-3 lg:grid-rows-2 gap-4 lg:gap-5">
            <div className="lg:col-span-2 lg:row-span-2 aspect-[4/5] rounded-2xl bg-[#EFEAE0] animate-pulse" />
            <div className="aspect-[4/5] rounded-2xl bg-[#EFEAE0] animate-pulse" />
            <div className="aspect-[4/5] rounded-2xl bg-[#EFEAE0] animate-pulse" />
          </div>
        </section>

        {/* Story | Workshop */}
        <section className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6 lg:gap-10 items-start">
          <div className="space-y-3">
            <div className="h-7 w-32 rounded-md bg-[#EFEAE0] animate-pulse" />
            <div className="h-4 w-full rounded bg-[#EFEAE0] animate-pulse" />
            <div className="h-4 w-11/12 rounded bg-[#EFEAE0] animate-pulse" />
            <div className="h-4 w-10/12 rounded bg-[#EFEAE0] animate-pulse" />
            <div className="h-4 w-9/12 rounded bg-[#EFEAE0] animate-pulse" />
          </div>
          <div className="aspect-[3/2] rounded-2xl bg-[#EFEAE0] animate-pulse" />
        </section>

        {/* All Listings */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="h-7 w-32 rounded-md bg-[#EFEAE0] animate-pulse" />
            <div className="h-4 w-28 rounded bg-[#EFEAE0] animate-pulse" />
          </div>
          <ul className="grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="space-y-2">
                <div className="aspect-[4/5] rounded-2xl bg-[#EFEAE0] animate-pulse" />
                <div className="h-3 w-3/4 rounded bg-[#EFEAE0] animate-pulse" />
                <div className="h-3 w-1/3 rounded bg-[#EFEAE0] animate-pulse" />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
