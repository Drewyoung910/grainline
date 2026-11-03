"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

// `useSearchParams` suspends while a route is prerendered, which pulls every
// component above it out of the server HTML up to the nearest Suspense
// boundary. The site header only needs the query string to react to
// navigation, so it reads it through this listener. The listener sits in
// its own boundary and renders nothing, which lets the header render in the
// first HTML flush instead of popping in after paint and shifting the page.
function SearchParamsReporter({ onChange }: { onChange: (query: string) => void }) {
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  React.useEffect(() => {
    onChange(query);
  }, [query, onChange]);
  return null;
}

export default function SearchParamsListener({ onChange }: { onChange: (query: string) => void }) {
  return (
    <React.Suspense fallback={null}>
      <SearchParamsReporter onChange={onChange} />
    </React.Suspense>
  );
}
