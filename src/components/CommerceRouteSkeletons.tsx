import { Pulse } from "@/components/RouteSkeletons";

export function SalesListSkeleton() {
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-8" aria-busy="true" aria-label="Loading sales">
      <header className="space-y-3">
        <Pulse className="h-7 w-28" />
        <Pulse className="h-4 w-72 max-w-full" />
      </header>
      <ul className="space-y-4" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, index) => (
          <li key={index} className="card-section overflow-hidden">
            <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
              <Pulse className="h-4 w-32" />
              <Pulse className="h-5 w-24 rounded-full" />
            </div>
            <div className="flex items-center gap-3 px-4 py-4">
              <Pulse className="h-14 w-14 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-2">
                <Pulse className="h-4 w-64 max-w-full" />
                <Pulse className="h-3 w-40 max-w-full" />
              </div>
              <Pulse className="h-9 w-24" />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function OrderDetailSkeleton() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8" aria-busy="true" aria-label="Loading order details">
      <header className="space-y-2">
        <Pulse className="h-8 w-56" />
        <Pulse className="h-4 w-40" />
      </header>

      <section className="card-section overflow-hidden" aria-hidden="true">
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
          <div className="space-y-2">
            <Pulse className="h-4 w-32" />
            <Pulse className="h-3 w-24" />
          </div>
          <Pulse className="h-5 w-20 rounded-full" />
        </div>
        <div className="divide-y divide-neutral-100">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 px-4 py-4">
              <Pulse className="h-16 w-16 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-2">
                <Pulse className="h-4 w-3/5" />
                <Pulse className="h-3 w-2/5" />
              </div>
              <Pulse className="h-4 w-16" />
            </div>
          ))}
        </div>
        <div className="space-y-2 border-t border-neutral-100 px-4 py-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex items-center justify-between gap-4">
              <Pulse className="h-3 w-24" />
              <Pulse className="h-3 w-16" />
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2" aria-hidden="true">
        {Array.from({ length: 2 }).map((_, index) => (
          <section key={index} className="card-section space-y-3 p-4">
            <Pulse className="h-5 w-32" />
            <Pulse className="h-4 w-full" />
            <Pulse className="h-4 w-3/4" />
            <Pulse className="h-10 w-32" />
          </section>
        ))}
      </div>
    </main>
  );
}

export function CheckoutSuccessSkeleton() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8" aria-busy="true" aria-label="Loading receipt">
      <header className="space-y-2">
        <Pulse className="h-8 w-72 max-w-full" />
        <Pulse className="h-4 w-52" />
      </header>
      <section className="card-section overflow-hidden" aria-hidden="true">
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
          <div className="space-y-2">
            <Pulse className="h-4 w-20" />
            <Pulse className="h-3 w-32" />
          </div>
          <Pulse className="h-4 w-20" />
        </div>
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3">
            <Pulse className="h-16 w-16 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <Pulse className="h-4 w-3/5" />
              <Pulse className="h-3 w-2/5" />
            </div>
            <Pulse className="h-4 w-16" />
          </div>
        ))}
        <div className="space-y-2 px-4 py-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex items-center justify-between gap-4">
              <Pulse className="h-3 w-24" />
              <Pulse className="h-3 w-16" />
            </div>
          ))}
        </div>
      </section>
      <div className="flex gap-3" aria-hidden="true">
        <Pulse className="h-10 w-32" />
        <Pulse className="h-10 w-28" />
      </div>
    </main>
  );
}

export function OnboardingSkeleton() {
  return (
    <main
      className="flex min-h-[100svh] flex-col items-center bg-[#F7F5F0] px-4 py-12"
      aria-busy="true"
      aria-label="Loading shop setup"
    >
      <div className="w-full max-w-xl">
        <section className="card-section space-y-5 p-8 text-center" aria-hidden="true">
          <Pulse className="mx-auto h-12 w-12 rounded-lg" />
          <Pulse className="mx-auto h-8 w-80 max-w-full" />
          <div className="space-y-2">
            <Pulse className="mx-auto h-4 w-96 max-w-full" />
            <Pulse className="mx-auto h-4 w-64 max-w-[80%]" />
          </div>
          <Pulse className="mx-auto h-11 w-36" />
        </section>
      </div>
    </main>
  );
}
