export function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[#EFEAE0] ${className}`} />;
}

export function AccountOverviewSkeleton() {
  return (
    <main className="mx-auto max-w-7xl space-y-10 p-6 md:p-8" aria-busy="true" aria-label="Loading account">
      <header className="flex items-center gap-4">
        <Pulse className="h-14 w-14 rounded-full" />
        <div className="space-y-2">
          <Pulse className="h-8 w-44" />
          <Pulse className="h-4 w-64 max-w-full" />
        </div>
      </header>
      <section className="space-y-4">
        <SectionHeader />
        <div className="card-section divide-y divide-neutral-100">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4 p-3">
              <Pulse className="h-14 w-14 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-2">
                <Pulse className="h-4 w-64 max-w-full" />
                <Pulse className="h-3 w-36 max-w-full" />
              </div>
              <Pulse className="h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-4">
        <SectionHeader />
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="card-listing w-40 shrink-0 overflow-hidden">
              <Pulse className="h-32 w-full rounded-none" />
              <div className="space-y-2 border-t border-neutral-100 bg-white p-2">
                <Pulse className="h-3 w-3/4" />
                <Pulse className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader />
        <div className="card-section divide-y divide-neutral-100">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0 flex-1 space-y-2">
                <Pulse className="h-4 w-72 max-w-full" />
                <Pulse className="h-3 w-32" />
              </div>
              <Pulse className="h-8 w-16 shrink-0" />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader />
        <div className="card-section flex items-center justify-between p-5">
          <div className="space-y-2">
            <Pulse className="h-7 w-10" />
            <Pulse className="h-3 w-28" />
          </div>
          <Pulse className="h-10 w-28" />
        </div>
      </section>

      <AccountInfoSection />
      <AccountInfoSection lines={2} />

      <section className="space-y-4">
        <Pulse className="h-6 w-40" />
        <div className="card-section space-y-3 p-5">
          <Pulse className="h-4 w-40" />
          <Pulse className="h-4 w-64 max-w-full" />
          <Pulse className="h-3 w-96 max-w-full" />
          <div className="flex flex-col items-start gap-2">
            <Pulse className="h-4 w-32" />
            <Pulse className="h-4 w-28" />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <Pulse className="h-6 w-40" />
        <div className="card-section space-y-4 p-5">
          <div className="flex gap-6">
            <div className="space-y-2">
              <Pulse className="h-7 w-10" />
              <Pulse className="h-3 w-24" />
            </div>
            <div className="space-y-2">
              <Pulse className="h-7 w-10" />
              <Pulse className="h-3 w-28" />
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Pulse className="h-10 w-36" />
            <Pulse className="h-10 w-28" />
            <Pulse className="h-10 w-28" />
          </div>
        </div>
      </section>
    </main>
  );
}

function AccountInfoSection({ lines = 1 }: { lines?: number }) {
  return (
    <section className="space-y-4">
      <Pulse className="h-6 w-44" />
      <div className="card-section space-y-3 p-4">
        {Array.from({ length: lines }).map((_, index) => (
          <Pulse key={index} className={`h-4 max-w-full ${index === 0 ? "w-72" : "w-52"}`} />
        ))}
        <Pulse className="h-4 w-40" />
      </div>
    </section>
  );
}

export function WorkshopSkeleton() {
  return (
    <main className="mx-auto max-w-7xl p-8" aria-busy="true" aria-label="Loading workshop">
      <header className="mb-10">
        <Pulse className="h-10 w-96 max-w-full" />
        <Pulse className="mt-3 h-4 w-64 max-w-full" />
        <div className="mt-8">
          <Pulse className="mb-3 h-4 w-24" />
          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
            {Array.from({ length: 10 }).map((_, index) => (
              <Pulse key={index} className="h-14 sm:h-10 sm:w-32" />
            ))}
          </div>
        </div>
        <div className="my-6 border-t border-stone-200/60" />
        <Pulse className="mb-3 h-4 w-28" />
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
          {Array.from({ length: 4 }).map((_, index) => (
            <Pulse key={index} className="h-14 sm:h-10 sm:w-32" />
          ))}
        </div>
        <Pulse className="mt-4 h-4 w-28" />
      </header>
      <section>
        <SectionHeader />
        <div className="mt-4 flex gap-4 overflow-hidden sm:grid sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="card-section w-[220px] shrink-0 overflow-hidden sm:w-auto">
              <Pulse className="aspect-[4/5] w-full rounded-none" />
              <div className="space-y-2 p-4">
                <Pulse className="h-4 w-3/4" />
                <Pulse className="h-3 w-1/2" />
                <Pulse className="h-8 w-full" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export function CommissionRoomSkeleton() {
  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6" aria-busy="true" aria-label="Loading commission room">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="space-y-3">
          <Pulse className="h-8 w-60" />
          <Pulse className="h-4 w-96 max-w-full" />
        </div>
        <Pulse className="h-10 w-32 shrink-0" />
      </div>
      <div className="mb-6 flex gap-2 border-b border-neutral-100 pb-2">
        <Pulse className="h-8 w-28" />
        <Pulse className="h-8 w-24" />
      </div>
      <section className="card-section mb-6 space-y-2 border-amber-200/60 bg-amber-50 p-4">
        <Pulse className="h-5 w-56" />
        <Pulse className="h-4 w-full" />
        <Pulse className="h-4 w-4/5" />
      </section>
      <div className="mb-6 flex gap-2 overflow-hidden">
        {Array.from({ length: 8 }).map((_, index) => (
          <Pulse key={index} className="h-8 w-20 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, index) => (
          <section key={index} className="card-section space-y-3 p-5">
            <div className="flex items-start justify-between gap-4">
              <Pulse className="h-5 w-64 max-w-full" />
              <Pulse className="h-5 w-20 rounded-full" />
            </div>
            <Pulse className="h-4 w-full" />
            <Pulse className="h-4 w-3/4" />
            <Pulse className="h-8 w-28" />
          </section>
        ))}
      </div>
    </main>
  );
}

export function BlogIndexSkeleton() {
  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 sm:px-6" aria-busy="true" aria-label="Loading blog posts">
      <section className="mb-8 py-12 text-center sm:py-16">
        <Pulse className="mx-auto mb-4 h-12 w-[32rem] max-w-full" />
        <Pulse className="mx-auto mb-6 h-5 w-[36rem] max-w-full" />
        <Pulse className="mx-auto h-11 w-xl max-w-full" />
      </section>
      <div className="mb-6 flex gap-2 overflow-hidden">
        {Array.from({ length: 5 }).map((_, index) => (
          <Pulse key={index} className="h-9 w-28 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <article key={index} className="card-section overflow-hidden">
            <Pulse className="aspect-[4/3] w-full rounded-none" />
            <div className="space-y-3 p-4">
              <Pulse className="h-5 w-4/5" />
              <Pulse className="h-4 w-full" />
              <Pulse className="h-3 w-2/3" />
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}

export function FeedSkeleton() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8" aria-busy="true" aria-label="Loading feed">
      <Pulse className="mb-4 h-4 w-24" />
      <div className="mb-6 flex items-center justify-between gap-4">
        <Pulse className="h-8 w-32" />
        <Pulse className="h-4 w-36" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, index) => (
          <article key={index} className="card-section overflow-hidden">
            <div className="flex items-center gap-3 border-b border-neutral-100 px-4 py-2">
              <Pulse className="h-5 w-20 rounded-full" />
              <Pulse className="h-3 w-28" />
              <Pulse className="ml-auto h-3 w-14" />
            </div>
            <Pulse className="aspect-[4/3] w-full rounded-none" />
            <div className="space-y-2 p-4">
              <Pulse className="h-4 w-3/4" />
              <Pulse className="h-3 w-1/2" />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function VerificationSkeleton() {
  return (
    <main className="mx-auto max-w-2xl space-y-10 px-4 py-8 sm:px-8" aria-busy="true" aria-label="Loading guild application">
      <div className="space-y-3">
        <Pulse className="h-8 w-72 max-w-full" />
        <Pulse className="h-4 w-full" />
      </div>
      {Array.from({ length: 2 }).map((_, section) => (
        <section key={section} className="space-y-4">
          <div className="flex items-center gap-2">
            <Pulse className="h-6 w-32" />
            <Pulse className="h-7 w-24 rounded-full" />
          </div>
          <Pulse className="h-4 w-96 max-w-full" />
          <div className="card-section space-y-3 p-5">
            <Pulse className="h-5 w-28" />
            {Array.from({ length: section === 0 ? 5 : 7 }).map((_, row) => (
              <div key={row} className="flex items-center gap-2">
                <Pulse className="h-4 w-4 rounded-full" />
                <Pulse className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

function SectionHeader() {
  return (
    <div className="flex items-center justify-between gap-4">
      <Pulse className="h-6 w-36" />
      <Pulse className="h-4 w-24" />
    </div>
  );
}
