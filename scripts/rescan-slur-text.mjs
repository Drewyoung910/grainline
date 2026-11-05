// One-time, read-only re-scan for slur-tier words in existing public text. Run it
// when the word list changes. It prints ids and field names only, never the text.
//
//   CONTENT_RESCAN_DATABASE_URL=... node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     --experimental-strip-types scripts/rescan-slur-text.mjs
//
// SellerProfile denies the application role, so the URL must be a role that can read
// it. The whole run is one READ ONLY transaction.
import { pathToFileURL } from "node:url";
import pg from "pg";
import { containsSlur } from "../src/lib/profanity.ts";

const QUERIES = [
  ["listing", `SELECT id, title, description, "metaDescription", tags, materials FROM "Listing"`],
  ["listing", `SELECT g."listingId" AS id, g.name AS "variantGroup",
      array_agg(o.label) FILTER (WHERE o.label IS NOT NULL) AS "variantOptions"
    FROM "ListingVariantGroup" g
    LEFT JOIN "ListingVariantOption" o ON o."groupId" = g.id
    GROUP BY g.id`],
  ["listing", `SELECT "listingId" AS id, "altText" FROM "Photo" WHERE "altText" IS NOT NULL`],
  ["shop", `SELECT id, "displayName", tagline, bio, "storyTitle", "storyBody", "returnPolicy",
      "customOrderPolicy", "shippingPolicy", "vacationMessage", city, state, "galleryAltTexts"
    FROM "SellerProfile"`],
  ["shop", `SELECT "sellerProfileId" AS id, question, answer FROM "SellerFaq"`],
];

export function fieldsWithSlur(row) {
  return Object.entries(row)
    .filter(([field, value]) => field !== "id" && containsSlur([value].flat().join("\n")))
    .map(([field]) => field);
}

async function main() {
  const connectionString = process.env.CONTENT_RESCAN_DATABASE_URL;
  if (!connectionString) throw new Error("CONTENT_RESCAN_DATABASE_URL is required.");
  const client = new pg.Client({ connectionString });
  await client.connect();
  const hits = new Map();
  try {
    await client.query("BEGIN READ ONLY");
    for (const [kind, sql] of QUERIES) {
      for (const row of (await client.query(sql)).rows) {
        const fields = fieldsWithSlur(row);
        if (fields.length === 0) continue;
        const key = `${kind} ${row.id}`;
        hits.set(key, [...(hits.get(key) ?? []), ...fields]);
      }
    }
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
  for (const [key, fields] of hits) console.log(`${key}: ${fields.join(", ")}`);
  console.log(`${hits.size} with a hit`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
