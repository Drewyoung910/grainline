// Skeleton for /messages/[id] — mirrors the chat thread layout: sticky
// header with avatar + name, a few message bubbles, and the composer.
export default function ThreadLoading() {
  return (
    <main className="min-h-[100svh] w-full max-w-full overflow-x-clip bg-[#F7F5F0]" aria-busy="true" aria-label="Loading">
      <div className="mx-auto w-full min-w-0 max-w-4xl px-0 py-0 sm:px-6 sm:py-6">
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

        <div className="min-w-0 space-y-4 px-0 pt-4 sm:px-5">
          {/* Listing context card */}
          <div className="mx-4 flex min-w-0 items-center gap-3 rounded-lg border border-stone-200/60 bg-[#EFEAE0] p-3 sm:mx-0">
            <div className="h-14 w-14 rounded-md bg-[#F7F5F0] animate-pulse" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-2/3 rounded bg-[#F7F5F0] animate-pulse" />
              <div className="h-3 w-20 rounded bg-[#F7F5F0] animate-pulse" />
            </div>
          </div>

          {/* Message bubbles (alternating) */}
          <div className="w-full min-w-0 max-w-full touch-pan-y space-y-3 overflow-x-hidden overscroll-contain px-4 md:px-0" style={{ minHeight: "55vh" }}>
            <div className="flex justify-start">
              <div className="h-9 w-56 max-w-[70%] rounded-2xl bg-[#EFEAE0] animate-pulse" />
            </div>
            <div className="flex justify-end">
              <div className="h-9 w-40 max-w-[70%] rounded-2xl bg-[#EFEAE0] animate-pulse" />
            </div>
            <div className="flex justify-start">
              <div className="h-16 w-72 max-w-[70%] rounded-2xl bg-[#EFEAE0] animate-pulse" />
            </div>
            <div className="flex justify-end">
              <div className="h-9 w-28 max-w-[70%] rounded-2xl bg-[#EFEAE0] animate-pulse" />
            </div>
          </div>
        </div>

        {/* Composer */}
        <div className="sticky bottom-0 w-full min-w-0 max-w-full overflow-x-clip border-t border-neutral-200 bg-[#EFEAE0] px-3 pt-3 pb-4 shadow-md sm:bottom-6 sm:mt-3 sm:rounded-2xl sm:border sm:border-stone-200/70 sm:px-4">
          <div className="flex w-full min-w-0 items-end gap-2">
            <div className="h-10 w-10 shrink-0 rounded-full bg-[#F7F5F0] animate-pulse" />
            <div className="h-10 flex-1 rounded-2xl bg-[#F7F5F0] animate-pulse" />
            <div className="h-10 w-20 rounded-full bg-[#2C1F1A]/40 animate-pulse" />
          </div>
        </div>
      </div>
    </main>
  );
}
