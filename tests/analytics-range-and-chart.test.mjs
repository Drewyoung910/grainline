import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { clampTooltipCenter } from "../src/app/dashboard/analytics/chartLayout.ts";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("seller analytics chart layout", () => {
  it("keeps peak tooltips inside the clipped chart card", () => {
    const page = source("src/app/dashboard/analytics/page.tsx");

    assert.match(page, /placement: "above" \| "below"/);
    assert.match(page, /placement: point\.y <= PAD_T \+ 56 \? "below" : "above"/);
    assert.match(
      page,
      /tooltip\.placement === "below" \? "12px" : "calc\(-100% - 12px\)"/,
    );
    assert.doesNotMatch(page, /transform: "translate\(-50%, -130%\)"/);
  });

  it("measures and clamps horizontal tooltip placement at narrow card edges", () => {
    const page = source("src/app/dashboard/analytics/page.tsx");

    assert.equal(clampTooltipCenter(12, 320, 100), 58);
    assert.equal(clampTooltipCenter(308, 320, 100), 262);
    assert.equal(clampTooltipCenter(160, 320, 100), 160);
    assert.equal(clampTooltipCenter(40, 120, 140), 60);

    assert.match(page, /const tooltipRef = useRef<HTMLDivElement>\(null\)/);
    assert.match(page, /const desiredCenter =[\s\S]*?svgRect\.width/);
    assert.match(page, /clampTooltipCenter\([\s\S]*?chartContainer\.clientWidth,[\s\S]*?visibleTooltip\.offsetWidth/);
    assert.match(page, /window\.addEventListener\("resize", positionTooltip\)/);
    assert.doesNotMatch(page, /point\.x <= PAD_L \+ 40/);
  });

  it("reserves space below rotated and long x-axis labels", () => {
    const page = source("src/app/dashboard/analytics/page.tsx");

    assert.match(page, /const SVG_H = 232/);
    assert.match(page, /const PAD_B = 56/);
    assert.match(page, /const X_LABEL_Y = SVG_H - 30/);
    assert.match(page, /y=\{X_LABEL_Y\}/);
    assert.match(page, /rotate\(-35, \$\{p\.x\.toFixed\(1\)\}, \$\{X_LABEL_Y\.toFixed\(1\)\}\)/);
    assert.doesNotMatch(page, /y=\{SVG_H - 6\}/);
  });

  it("pins click, drag, touch, and keyboard selections until a new selection", () => {
    const page = source("src/app/dashboard/analytics/page.tsx");

    assert.match(page, /const pinnedIndexRef = useRef<number \| null>\(null\)/);
    assert.match(page, /onPointerDown=\{\(event\) => \{[\s\S]*?updatePointerSelection\(event\)/);
    assert.match(page, /onPointerUp=\{\(event\) => \{[\s\S]*?pinCurrentPoint\(\)/);
    assert.match(page, /onPointerCancel=\{\(event\) => \{[\s\S]*?pinCurrentPoint\(\)/);
    assert.match(page, /pinnedIndexRef\.current === null/);
    assert.match(page, /role="slider"/);
    assert.match(page, /tabIndex=\{0\}/);
    assert.match(page, /aria-orientation="horizontal"/);
    assert.match(page, /onFocus=\{\(\) => \{/);
    assert.match(page, /event\.key === "ArrowLeft"/);
    assert.match(page, /event\.key === "ArrowDown"/);
    assert.match(page, /event\.key === "ArrowRight"/);
    assert.match(page, /event\.key === "ArrowUp"/);
    assert.match(page, /key=\{data\.range\}/);
    assert.doesNotMatch(page, /key=\{`\$\{data\.range\}-\$\{chartMetric\}`\}/);
    assert.match(page, /useEffect\(\(\) => \{[\s\S]*?pinnedIndexRef\.current = null;[\s\S]*?\}, \[metric\]\)/);
    assert.doesNotMatch(
      page,
      /onPointerLeave=\{\(\) => \{\s*if \(!draggingRef\.current\) \{\s*setActiveIdx\(null\)/,
    );
  });

  it("keeps metric-button focus while clearing a stale pinned point", () => {
    const page = source("src/app/dashboard/analytics/page.tsx");

    assert.match(page, /key=\{data\.range\}/);
    assert.match(page, /selectedIndexRef\.current = null/);
    assert.match(page, /pinnedIndexRef\.current = null/);
    assert.match(page, /setActiveIdx\(null\)/);
    assert.match(page, /setTooltip\(null\)/);
  });

  it("keeps analytics page and section titles on the shared display hierarchy", () => {
    const page = source("src/app/dashboard/analytics/page.tsx");

    assert.match(page, /<h1 className="font-display text-3xl font-bold">Analytics<\/h1>/);
    for (const title of [
      "Performance Over Time",
      "Overview",
      "Engagement",
      "Top Listings",
      "Guild Metrics",
      "Rating Over Time",
      "Recent Sales",
    ]) {
      assert.match(page, new RegExp(`<h2 className="font-display [^"]+">${title}<\\/h2>`));
    }
  });
});

describe("seller analytics Top Listings range", () => {
  it("scopes every displayed listing statistic to the selected time range", () => {
    const route = source("src/app/api/seller/analytics/route.ts");
    const authority = source("src/lib/orderSellerAnalyticsAuthority.ts");
    const migration = source(
      "prisma/migrations/20260901060000_prepare_order_seller_analytics_authority/migration.sql",
    );

    assert.match(route, /readSellerOrderTopListings\(\{[\s\S]*actorUserId: me\.id/);
    assert.match(route, /startDate,[\s\S]*endDate,[\s\S]*endExclusive,[\s\S]*allTime: range === "alltime"/);
    assert.match(authority, /grainline_order_seller_analytics_top_listings/);
    assert.match(migration, /WITH seller_actor AS \([\s\S]*seller\."userId" = p_actor_user_id/);
    assert.match(migration, /sales AS \([\s\S]*source_order\."createdAt" >= range_start/);
    assert.match(migration, /daily_views AS \([\s\S]*view_daily\.date >= range_start/);
    assert.match(migration, /favorites AS \([\s\S]*favorite\."createdAt" >= range_start/);
    assert.match(migration, /watchers AS \([\s\S]*stock_notification\."createdAt" >= range_start/);
    assert.match(migration, /WHEN p_all_time THEN seller_listings\."viewCount"::bigint/);
    assert.match(migration, /WHEN p_all_time THEN seller_listings\."clickCount"::bigint/);
    assert.match(migration, /WHERE combined\.revenue > 0[\s\S]*OR combined\.watcher_value > 0/);
    assert.match(
      migration,
      /ORDER BY combined\.revenue DESC, combined\.views DESC,[\s\S]*combined\.clicks DESC, combined\.id ASC/,
    );
  });

  it("calculates revenue pace over the selected active period", () => {
    const route = source("src/app/api/seller/analytics/route.ts");
    const page = source("src/app/dashboard/analytics/page.tsx");

    assert.match(
      route,
      /const activeStartMs = Math\.max\(startDate\.getTime\(\), r\.createdAt\.getTime\(\)\)/,
    );
    assert.match(
      route,
      /Math\.ceil\(\(endDate\.getTime\(\) - activeStartMs\) \/ \(1000 \* 60 \* 60 \* 24\)\)/,
    );
    assert.match(
      route,
      /revenuePerActiveDayCents: Math\.round\(r\.totalRevenueCents \/ activeDaysInRange\)/,
    );
    assert.doesNotMatch(route, /const daysSinceCreated/);
    assert.match(page, /No listing activity for this period\./);
    assert.doesNotMatch(page, /No sales data yet\./);
  });
});
