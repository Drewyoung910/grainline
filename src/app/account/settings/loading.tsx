function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[#EFEAE0] ${className}`} />;
}

function PreferenceCard({ rows }: { rows: number }) {
  return (
    <section className="card-section mb-4 p-5">
      <Pulse className="mb-2 h-5 w-48 max-w-full" />
      <Pulse className="mb-3 h-3 w-16" />
      <div className="divide-y divide-neutral-100">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Pulse className="h-4 w-48 max-w-full" />
              <Pulse className="h-3 w-80 max-w-full" />
            </div>
            <Pulse className="h-6 w-11 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function AccountSettingsLoading() {
  return (
    <main className="mx-auto max-w-2xl space-y-8 p-6 md:p-8" aria-busy="true" aria-label="Loading account settings">
      <Pulse className="h-4 w-24" />
      <header className="space-y-2">
        <Pulse className="h-9 w-80 max-w-full" />
        <Pulse className="h-4 w-96 max-w-full" />
      </header>
      <div>
        <Pulse className="h-6 w-44" />
        <Pulse className="mb-4 mt-2 h-4 w-full max-w-lg" />
        <PreferenceCard rows={3} />
        <PreferenceCard rows={9} />
        <PreferenceCard rows={6} />
        <PreferenceCard rows={2} />
      </div>
      <section className="card-section space-y-3 p-5">
        <Pulse className="h-6 w-32" />
        <Pulse className="h-4 w-full" />
        <Pulse className="h-10 w-44" />
      </section>
      <section className="card-section space-y-3 border-red-200 bg-red-50/40 p-5">
        <Pulse className="h-6 w-32" />
        <Pulse className="h-4 w-full" />
        <Pulse className="h-10 w-36" />
      </section>
    </main>
  );
}
