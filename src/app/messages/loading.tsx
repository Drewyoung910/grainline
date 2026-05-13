// Skeleton for /messages — mirrors the live layout: header row, tab pills
// row, search, then a cream list of conversation rows.
export default function MessagesLoading() {
  return (
    <main className="mx-auto max-w-4xl p-8" aria-busy="true" aria-label="Loading">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between">
        <div className="h-8 w-36 rounded-md bg-[#EFEAE0] animate-pulse" />
        <div className="h-4 w-28 rounded bg-[#EFEAE0] animate-pulse" />
      </div>

      {/* Tabs + search */}
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-8 w-20 rounded-full bg-[#EFEAE0] animate-pulse" />
          ))}
        </div>
        <div className="h-9 w-full sm:w-64 sm:ml-auto rounded-full bg-[#EFEAE0] animate-pulse" />
      </div>

      {/* Conversation list */}
      <ul className="rounded-lg bg-[#EFEAE0] overflow-hidden divide-y divide-stone-300/50">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 shrink-0 rounded-full bg-[#E3DCCB] animate-pulse" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-2/5 rounded bg-[#E3DCCB] animate-pulse" />
                <div className="h-3 w-3/5 rounded bg-[#E3DCCB] animate-pulse" />
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-[#E3DCCB] animate-pulse" />
                <div className="h-3 w-16 rounded bg-[#E3DCCB] animate-pulse hidden sm:block" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
