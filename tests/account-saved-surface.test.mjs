import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const accountPage = readFileSync(
  new URL("../src/app/account/page.tsx", import.meta.url),
  "utf8",
);
const routeSkeletons = readFileSync(
  new URL("../src/components/RouteSkeletons.tsx", import.meta.url),
  "utf8",
);

describe("account saved items surface", () => {
  it("uses the shared scroll fade with compact floating listing details", () => {
    assert.match(accountPage, /import ScrollFadeRow from "@\/components\/ScrollFadeRow"/);
    assert.match(accountPage, /<ScrollFadeRow className="-mx-1 overflow-x-auto px-1">/);
    assert.match(accountPage, /className="group w-40 shrink-0 snap-start"/);
    assert.match(accountPage, /aspect-\[4\/3\].*overflow-hidden rounded-lg bg-\[#EFEAE0\]/);
    assert.match(accountPage, /<div className="mt-2 space-y-0\.5 px-0\.5">/);
    assert.doesNotMatch(accountPage, /className="card-listing shrink-0 w-40/);
    assert.doesNotMatch(accountPage, /p-2 bg-white border-t border-neutral-100/);
    assert.doesNotMatch(accountPage, /seller: \{\s*select: \{ displayName: true \}/);
  });

  it("keeps the account fallback on the same borderless image-and-text treatment", () => {
    const accountStart = routeSkeletons.indexOf("export function AccountOverviewSkeleton");
    const workshopStart = routeSkeletons.indexOf("export function WorkshopSkeleton");
    const accountSkeleton = routeSkeletons.slice(accountStart, workshopStart);

    assert.match(accountSkeleton, /className="w-40 shrink-0"/);
    assert.match(accountSkeleton, /aspect-\[4\/3\] w-full rounded-lg/);
    assert.match(accountSkeleton, /className="mt-2 space-y-1 px-0\.5"/);
    assert.doesNotMatch(accountSkeleton, /card-listing w-40/);
    assert.doesNotMatch(accountSkeleton, /border-t border-neutral-100 bg-white p-2/);
  });
});
