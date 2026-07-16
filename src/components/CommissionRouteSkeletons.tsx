import { Pulse } from "@/components/RouteSkeletons";

function CommissionBreadcrumbSkeleton({ detail = false }: { detail?: boolean }) {
  return (
    <div className="mb-5 flex items-center gap-2" aria-hidden="true">
      {!detail && (
        <>
          <Pulse className="h-4 w-10" />
          <Pulse className="h-4 w-2" />
        </>
      )}
      <Pulse className="h-4 w-28" />
      <Pulse className="h-4 w-2" />
      <Pulse className="h-4 w-32" />
    </div>
  );
}

export function CommissionMetroSkeleton() {
  return (
    <main
      className="mx-auto max-w-4xl px-4 pb-16 pt-8 sm:px-6"
      aria-busy="true"
      aria-label="Loading local commission requests"
    >
      <CommissionBreadcrumbSkeleton />

      <header className="mb-8 space-y-3" aria-hidden="true">
        <Pulse className="h-9 w-[34rem] max-w-full" />
        <div className="space-y-2">
          <Pulse className="h-4 w-[46rem] max-w-full" />
          <Pulse className="h-4 w-[32rem] max-w-[85%]" />
        </div>
      </header>

      <ul className="mb-12 space-y-4" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, index) => (
          <li key={index} className="card-section p-5">
            <div className="flex items-start gap-4">
              {index % 2 === 0 && <Pulse className="h-16 w-16 shrink-0 rounded-lg" />}
              <div className="min-w-0 flex-1 space-y-2">
                <Pulse className="h-5 w-3/5" />
                <Pulse className="h-4 w-full" />
                <Pulse className="h-4 w-4/5" />
                <div className="flex flex-wrap gap-3 pt-1">
                  <Pulse className="h-3 w-20" />
                  <Pulse className="h-3 w-24" />
                  <Pulse className="h-3 w-16" />
                  <Pulse className="h-3 w-28" />
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div aria-hidden="true">
        <Pulse className="h-10 w-48" />
      </div>
    </main>
  );
}

export function CommissionDetailSkeleton() {
  return (
    <main
      className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6"
      aria-busy="true"
      aria-label="Loading commission details"
    >
      <CommissionBreadcrumbSkeleton detail />

      <header className="mb-6 flex items-start justify-between gap-4" aria-hidden="true">
        <Pulse className="h-8 w-[28rem] max-w-[70%]" />
        <Pulse className="h-[42px] w-36 shrink-0" />
      </header>

      <div
        className="mb-6 flex flex-wrap gap-x-4 gap-y-2 border-b border-neutral-100 pb-6"
        aria-hidden="true"
      >
        <Pulse className="h-6 w-24 rounded-full" />
        <Pulse className="h-4 w-32" />
        <Pulse className="h-4 w-28" />
        <Pulse className="h-4 w-24" />
      </div>

      <section className="mb-6 space-y-3" aria-hidden="true">
        <Pulse className="h-5 w-28" />
        <Pulse className="h-4 w-full" />
        <Pulse className="h-4 w-full" />
        <Pulse className="h-4 w-4/5" />
      </section>

      <section className="mb-6" aria-hidden="true">
        <Pulse className="mb-3 h-5 w-32" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Pulse key={index} className="aspect-[4/3] w-full rounded-lg" />
          ))}
        </div>
      </section>

      <section className="space-y-3 border-b border-neutral-100 pb-6" aria-hidden="true">
        <Pulse className="h-5 w-20" />
        <div className="flex items-center gap-2">
          <Pulse className="h-8 w-8 rounded-full" />
          <Pulse className="h-4 w-24" />
        </div>
      </section>
    </main>
  );
}
