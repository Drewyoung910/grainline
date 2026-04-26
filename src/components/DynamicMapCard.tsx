"use client";

import dynamic from "next/dynamic";

const DynamicMapCard = dynamic(() => import("@/components/MapCard"), {
  ssr: false,
  loading: () => <div className="h-48 w-full rounded-lg bg-neutral-100" />,
});

export default DynamicMapCard;
