type PageLoadingSkeletonProps = {
  variant?: "grid" | "table" | "detail";
};

function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200 ${className}`} />;
}

export default function PageLoadingSkeleton({ variant = "grid" }: PageLoadingSkeletonProps) {
  return (
    <main className="mx-auto max-w-6xl p-6 sm:p-8 space-y-6" aria-busy="true" aria-label="Loading">
      <header className="space-y-3">
        <Pulse className="h-7 w-44" />
        <Pulse className="h-4 w-72 max-w-full" />
      </header>

      {variant === "table" ? (
        <section className="card-section divide-y divide-neutral-100">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="grid grid-cols-[1fr_auto] gap-4 px-4 py-4">
              <div className="space-y-2">
                <Pulse className="h-4 w-48 max-w-full" />
                <Pulse className="h-3 w-72 max-w-full" />
              </div>
              <Pulse className="h-8 w-24" />
            </div>
          ))}
        </section>
      ) : variant === "detail" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="card-section p-4 space-y-4">
            <Pulse className="aspect-[4/3] w-full" />
            <Pulse className="h-5 w-2/3" />
            <Pulse className="h-4 w-full" />
            <Pulse className="h-4 w-5/6" />
          </section>
          <aside className="card-section p-4 space-y-3">
            <Pulse className="h-6 w-32" />
            <Pulse className="h-10 w-full" />
            <Pulse className="h-10 w-full" />
          </aside>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <section key={index} className="card-section overflow-hidden">
              <Pulse className="aspect-[4/3] w-full rounded-none" />
              <div className="space-y-2 p-4">
                <Pulse className="h-4 w-3/4" />
                <Pulse className="h-4 w-1/2" />
                <Pulse className="h-3 w-2/3" />
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
