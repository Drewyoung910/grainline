function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[#EFEAE0] ${className}`} />;
}

export default function DashboardBlogLoading() {
  return (
    <main className="mx-auto max-w-7xl p-8" aria-busy="true" aria-label="Loading blog posts">
      <div className="mb-8 flex items-center justify-between">
        <div className="space-y-3">
          <Pulse className="h-7 w-44" />
          <Pulse className="h-4 w-32" />
        </div>
        <Pulse className="h-10 w-28" />
      </div>
      <ul className="card-section divide-y divide-neutral-100">
        {Array.from({ length: 6 }).map((_, index) => (
          <li key={index} className="flex items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex gap-2">
                <Pulse className="h-5 w-20 rounded-full" />
                <Pulse className="h-5 w-20 rounded-full" />
              </div>
              <Pulse className="h-4 w-72 max-w-full" />
              <Pulse className="h-3 w-44 max-w-full" />
            </div>
            <div className="hidden gap-2 sm:flex">
              <Pulse className="h-8 w-16" />
              <Pulse className="h-8 w-16" />
              <Pulse className="h-8 w-20" />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
