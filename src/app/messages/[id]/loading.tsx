// Skeleton for /messages/[id] — mirrors the chat thread layout: sticky
// header with avatar + name, a few message bubbles, and the composer.
export default function ThreadLoading() {
  return (
    <main className="bg-[#F7F5F0] min-h-[100svh]" aria-busy="true" aria-label="Loading">
      <div className="max-w-4xl mx-auto px-0 sm:px-6 py-0 sm:py-6">
        {/* Header */}
        <header className="bg-[#F7F5F0] border-b border-neutral-200 px-4 sm:px-5 py-3 sm:rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="h-4 w-16 rounded bg-[#EFEAE0] animate-pulse" />
            <div className="h-10 w-10 rounded-full bg-[#EFEAE0] animate-pulse" />
            <div className="min-w-0 flex-1">
              <div className="h-4 w-40 max-w-full rounded bg-[#EFEAE0] animate-pulse" />
            </div>
            <div className="hidden sm:flex items-center gap-1.5">
              <div className="h-7 w-28 rounded-md bg-[#EFEAE0] animate-pulse" />
              <div className="h-7 w-20 rounded-md bg-[#EFEAE0] animate-pulse" />
            </div>
            <div className="h-7 w-7 rounded-full bg-[#EFEAE0] animate-pulse" />
          </div>
        </header>

        <div className="px-4 sm:px-5 pt-4 space-y-4">
          {/* Listing context card */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-white border border-stone-200/60">
            <div className="h-14 w-14 rounded-md bg-[#EFEAE0] animate-pulse" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-2/3 rounded bg-[#EFEAE0] animate-pulse" />
              <div className="h-3 w-20 rounded bg-[#EFEAE0] animate-pulse" />
            </div>
          </div>

          {/* Message bubbles (alternating) */}
          <div className="space-y-3" style={{ minHeight: "55vh" }}>
            <div className="flex justify-start">
              <div className="h-9 w-56 max-w-[70%] rounded-2xl bg-[#EFEAE0] animate-pulse" />
            </div>
            <div className="flex justify-end">
              <div className="h-9 w-40 max-w-[70%] rounded-2xl bg-[#E3DCCB] animate-pulse" />
            </div>
            <div className="flex justify-start">
              <div className="h-16 w-72 max-w-[70%] rounded-2xl bg-[#EFEAE0] animate-pulse" />
            </div>
            <div className="flex justify-end">
              <div className="h-9 w-28 max-w-[70%] rounded-2xl bg-[#E3DCCB] animate-pulse" />
            </div>
          </div>
        </div>

        {/* Composer */}
        <div className="sticky bottom-0 sm:bottom-6 bg-white border-t border-neutral-200 sm:border sm:border-stone-200/70 sm:rounded-2xl sm:mt-3 px-3 sm:px-4 pt-3 pb-4 shadow-md">
          <div className="flex items-end gap-2">
            <div className="h-10 w-10 shrink-0 rounded-full bg-[#EFEAE0] animate-pulse" />
            <div className="h-10 flex-1 rounded-2xl bg-[#EFEAE0] animate-pulse" />
            <div className="h-10 w-20 rounded-full bg-[#EFEAE0] animate-pulse" />
          </div>
        </div>
      </div>
    </main>
  );
}
