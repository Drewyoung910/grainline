function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[#EFEAE0] ${className}`} />;
}

function Field({ multiline = false }: { multiline?: boolean }) {
  return (
    <div className="space-y-2">
      <Pulse className="h-4 w-28" />
      <Pulse className={multiline ? "h-24 w-full" : "h-10 w-full"} />
    </div>
  );
}

export function BlogManagerSkeleton() {
  return (
    <main className="mx-auto max-w-7xl p-8" aria-busy="true" aria-label="Loading blog posts">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div className="space-y-3">
          <Pulse className="h-7 w-44" />
          <Pulse className="h-4 w-32" />
        </div>
        <Pulse className="h-10 w-28 shrink-0" />
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

function BlogEditorFields() {
  return (
    <>
      <Field />
      <div className="space-y-2">
        <Pulse className="h-4 w-20" />
        <Pulse className="h-10 w-44" />
      </div>
      <div className="space-y-2">
        <Pulse className="h-4 w-24" />
        <Pulse className="h-10 w-40" />
      </div>
      <Field />
      <div className="space-y-2">
        <Pulse className="h-4 w-16" />
        <Pulse className="h-10 w-full" />
        <Pulse className="h-64 w-full" />
      </div>
      <Field multiline />
      <Field multiline />
      <Field />
      <Pulse className="h-10 w-32" />
    </>
  );
}

export function BlogEditorSkeleton({ variant = "new" }: { variant?: "new" | "edit" }) {
  if (variant === "edit") {
    return (
      <main className="mx-auto max-w-3xl p-8" aria-busy="true" aria-label="Loading post editor">
        <Pulse className="mb-6 h-7 w-24" />
        <div className="space-y-6">
          <BlogEditorFields />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-8" aria-busy="true" aria-label="Loading post editor">
      <header className="space-y-2">
        <Pulse className="h-7 w-44" />
        <Pulse className="h-4 w-96 max-w-full" />
      </header>
      <section className="card-section p-6">
        <div className="space-y-6">
          <BlogEditorFields />
        </div>
      </section>
    </main>
  );
}

export function CreateListingSkeleton() {
  return (
    <main className="mx-auto max-w-2xl p-8" aria-busy="true" aria-label="Loading listing form">
      <Pulse className="mb-6 h-7 w-44" />
      <div className="space-y-4">
        <Field />
        <Field multiline />
        <Field multiline />
        <Field />
        <div className="space-y-2">
          <Pulse className="h-4 w-48" />
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, index) => <Pulse key={index} className="h-10 w-full" />)}
          </div>
        </div>
        <Field />
        <div className="space-y-2">
          <Pulse className="h-4 w-16" />
          <Pulse className="aspect-[4/3] w-full" />
        </div>
        <Field />
        <section className="card-section space-y-4 p-4">
          <Pulse className="h-5 w-64 max-w-full" />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, index) => <Pulse key={index} className="h-10 w-full" />)}
          </div>
        </section>
        <div className="flex gap-3 pt-2">
          <Pulse className="h-11 flex-1" />
          <Pulse className="h-11 flex-1" />
        </div>
      </div>
    </main>
  );
}

function ProfileSection({ rows = 3, media = false }: { rows?: number; media?: boolean }) {
  return (
    <section className="card-section space-y-4 p-6">
      <Pulse className="h-6 w-40" />
      {media ? <Pulse className="aspect-[3/1] w-full" /> : null}
      {Array.from({ length: rows }).map((_, index) => <Field key={index} multiline={index === rows - 1 && rows > 3} />)}
    </section>
  );
}

export function ShopProfileSkeleton() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-8" aria-busy="true" aria-label="Loading shop profile">
      <header className="flex items-center justify-between gap-4">
        <Pulse className="h-7 w-36" />
        <Pulse className="h-10 w-36" />
      </header>
      <section className="card-section space-y-4 p-6">
        <Pulse className="h-6 w-32" />
        <div className="space-y-2">
          <Pulse className="h-4 w-24" />
          <div className="flex items-center gap-3">
            <Pulse className="h-20 w-20 shrink-0 rounded-full" />
            <Pulse className="h-9 w-32" />
          </div>
        </div>
        <div className="space-y-2">
          <Pulse className="h-4 w-28" />
          <Pulse className="aspect-[3/1] w-full" />
        </div>
        <Field />
        <Field />
        <div className="w-40"><Field /></div>
      </section>
      <section className="card-section space-y-4 p-6">
        <Pulse className="h-6 w-28" />
        <Field multiline />
        <Field />
        <Field multiline />
        <div className="space-y-2">
          <Pulse className="h-4 w-32" />
          <Pulse className="aspect-[3/2] w-full" />
        </div>
      </section>
      <ProfileSection rows={5} />
      <ProfileSection rows={3} />
    </main>
  );
}

export function SellerSettingsSkeleton() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-8" aria-busy="true" aria-label="Loading shop settings">
      <Pulse className="h-7 w-40" />
      <section className="card-section space-y-3 p-6">
        <Pulse className="h-6 w-44" />
        <Pulse className="h-4 w-full" />
        <Pulse className="h-10 w-40" />
      </section>
      <section className="card-section space-y-4 p-6">
        <Pulse className="h-6 w-36" />
        <Pulse className="h-4 w-4/5" />
        <Pulse className="h-10 w-full" />
      </section>
      <section className="card-section space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field />
          <Field />
        </div>
        <div className="space-y-2">
          <Pulse className="h-4 w-28" />
          <Pulse className="h-72 w-full" />
        </div>
        <Pulse className="h-6 w-36" />
        <Field />
        <Field />
        <Pulse className="h-6 w-40" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Pulse key={index} className="h-10 w-full" />)}
        </div>
        <Pulse className="h-10 w-32" />
      </section>
      <ProfileSection rows={5} />
    </main>
  );
}

export function BuyerOrdersSkeleton() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8" aria-busy="true" aria-label="Loading orders">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="space-y-2">
          <Pulse className="h-7 w-28" />
          <Pulse className="h-4 w-64 max-w-full" />
        </div>
        <Pulse className="h-10 w-40" />
      </header>
      <ul className="space-y-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <li key={index} className="card-section overflow-hidden">
            <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
              <div className="space-y-2">
                <Pulse className="h-4 w-32" />
                <Pulse className="h-3 w-24" />
              </div>
              <Pulse className="h-5 w-20" />
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <Pulse className="h-16 w-16 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-2">
                <Pulse className="h-4 w-64 max-w-full" />
                <Pulse className="h-3 w-36" />
                <Pulse className="h-4 w-20" />
              </div>
              <Pulse className="h-4 w-16" />
            </div>
            <div className="space-y-2 border-t border-neutral-100 px-4 py-3">
              {Array.from({ length: 4 }).map((_, row) => (
                <div key={row} className="flex justify-between gap-4">
                  <Pulse className="h-3 w-28" />
                  <Pulse className="h-3 w-16" />
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function MakerMapSkeleton() {
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6" aria-busy="true" aria-label="Loading makers map">
      <header className="space-y-2">
        <Pulse className="h-7 w-40" />
        <Pulse className="h-4 w-80 max-w-full" />
      </header>
      <section className="overflow-hidden rounded-lg border border-stone-200/60">
        <Pulse className="h-[520px] w-full rounded-none" />
      </section>
      <section className="space-y-4 border-t border-neutral-100 pt-6">
        <Pulse className="h-4 w-44" />
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="space-y-2">
            <Pulse className="h-4 w-36" />
            <Pulse className="h-3 w-64 max-w-full" />
          </div>
        ))}
      </section>
    </main>
  );
}

export function SellerShopSkeleton() {
  return (
    <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading maker shop">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <Pulse className="h-10 w-10 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Pulse className="h-6 w-56 max-w-full" />
          <Pulse className="h-4 w-24" />
        </div>
        <Pulse className="h-4 w-28" />
      </header>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 gap-2 overflow-hidden">
          {Array.from({ length: 5 }).map((_, index) => <Pulse key={index} className="h-8 w-20 shrink-0 rounded-full" />)}
        </div>
        <Pulse className="h-9 w-36 shrink-0" />
      </div>
      <Pulse className="mb-4 h-4 w-20" />
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <li key={index}>
            <Pulse className="aspect-[4/5] w-full rounded-2xl" />
            <div className="flex items-center gap-3 pt-2.5">
              <div className="min-w-0 flex-1 space-y-2">
                <Pulse className="h-4 w-4/5" />
                <Pulse className="h-4 w-20" />
                <Pulse className="h-3 w-28" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function SellerProfileSkeleton() {
  return (
    <main className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading maker profile">
      <div className="relative mt-4 aspect-[3/1]">
        <Pulse className="absolute inset-0 rounded-2xl" />
        <Pulse className="absolute bottom-0 left-6 h-24 w-24 translate-y-1/2 rounded-full ring-4 ring-[#F7F5F0] sm:left-8" />
      </div>
      <div className="space-y-4 px-2 pb-2 pt-16 sm:px-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Pulse className="h-8 w-64 max-w-full" />
          <Pulse className="h-4 w-32" />
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, index) => <Pulse key={index} className="h-5 w-28" />)}
        </div>
        <div className="max-w-2xl space-y-2">
          <Pulse className="h-4 w-full" />
          <Pulse className="h-4 w-3/4" />
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, index) => <Pulse key={index} className="h-9 w-32" />)}
        </div>
      </div>
      <div className="mt-6 space-y-10 px-2 pb-12 sm:px-4">
        <section>
          <Pulse className="mb-4 h-7 w-40" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:grid-rows-2 lg:gap-5">
            <Pulse className="aspect-[4/5] lg:col-span-2 lg:row-span-2" />
            <Pulse className="aspect-[4/5]" />
            <Pulse className="aspect-[4/5]" />
          </div>
        </section>
        <section className="grid items-start gap-6 lg:grid-cols-[1.6fr_1fr] lg:gap-10">
          <div className="space-y-3">
            <Pulse className="h-7 w-32" />
            <Pulse className="h-4 w-full" />
            <Pulse className="h-4 w-10/12" />
          </div>
          <Pulse className="aspect-[3/2]" />
        </section>
      </div>
    </main>
  );
}
