#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PREDECESSOR =
  "20260831233000_prepare_order_participant_list_authority";

function extractFunction(sql, name, nextMarker) {
  const start = sql.indexOf(`CREATE FUNCTION public.${name}(`);
  const end = sql.indexOf(nextMarker, start);
  assert.ok(start >= 0 && end > start, `${name} predecessor body is absent`);
  return sql.slice(start, end).trim();
}

export function buildOrderParticipantListProjectionCorrection(
  root = process.cwd(),
) {
  const predecessor = readFileSync(
    path.join(
      root,
      "prisma",
      "migrations",
      PREDECESSOR,
      "migration.sql",
    ),
    "utf8",
  );
  const buyer = extractFunction(
    predecessor,
    "grainline_order_buyer_page",
    "CREATE FUNCTION public.grainline_order_seller_count(",
  )
    .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
    .replace(
      '    source_order."shippingTitle",',
      '    source_order."shippingTitle"::text,',
    );
  const seller = extractFunction(
    predecessor,
    "grainline_order_seller_page",
    "REVOKE ALL ON FUNCTION public.grainline_order_buyer_count",
  )
    .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
    .replace(
      '    source_order."shippingTitle",',
      '    source_order."shippingTitle"::text,',
    )
    .replace(
      '      ELSE source_order."buyerName"\n    END,',
      '      ELSE source_order."buyerName"::text\n    END,',
    )
    .replace(
      '      ELSE source_order."buyerEmail"\n    END,',
      '      ELSE source_order."buyerEmail"::text\n    END,',
    );
  assert.notEqual(buyer, extractFunction(
    predecessor,
    "grainline_order_buyer_page",
    "CREATE FUNCTION public.grainline_order_seller_count(",
  ));
  assert.match(buyer, /"shippingTitle"::text/);
  assert.match(seller, /"shippingTitle"::text/);
  assert.match(seller, /"buyerName"::text/);
  assert.match(seller, /"buyerEmail"::text/);

  return `-- Correct the compatible Order participant list projections against
-- the real Prisma schema. Order.shippingTitle, buyerName and buyerEmail are
-- varchar columns; PostgreSQL requires exact text casts for RETURNS TABLE
-- functions. The predecessor synthetic proof used text columns and did not
-- exercise this real-schema distinction. RLS and table grants are unchanged.

${buyer}

${seller}

REVOKE ALL ON FUNCTION public.grainline_order_buyer_page(
  text, integer, bigint, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_seller_page(
  text, integer, bigint, text
) FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_order_buyer_page(
  text, integer, bigint, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_seller_page(
  text, integer, bigint, text
) TO grainline_app_runtime;

`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(buildOrderParticipantListProjectionCorrection());
}
