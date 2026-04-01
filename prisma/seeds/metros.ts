// prisma/seeds/metros.ts
// Seeds Texas metro areas for city-level SEO pages.
// Major metros have no parent; child metros roll up to the nearest major metro.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

const MAJOR_METROS = [
  { slug: "austin-tx",          name: "Austin",          state: "TX", latitude: 30.2672, longitude: -97.7431 },
  { slug: "houston-tx",         name: "Houston",         state: "TX", latitude: 29.7604, longitude: -95.3698 },
  { slug: "dallas-tx",          name: "Dallas",          state: "TX", latitude: 32.7767, longitude: -96.7970 },
  { slug: "san-antonio-tx",     name: "San Antonio",     state: "TX", latitude: 29.4241, longitude: -98.4936 },
  { slug: "fort-worth-tx",      name: "Fort Worth",      state: "TX", latitude: 32.7555, longitude: -97.3308 },
  { slug: "college-station-tx", name: "College Station", state: "TX", latitude: 30.6280, longitude: -96.3344 },
  { slug: "waco-tx",            name: "Waco",            state: "TX", latitude: 31.5493, longitude: -97.1467 },
];

// [slug, name, state, lat, lng, parentSlug]
const CHILD_METROS: Array<[string, string, string, number, number, string]> = [
  ["round-rock-tx",    "Round Rock",    "TX", 30.5083, -97.6789, "austin-tx"],
  ["cedar-park-tx",    "Cedar Park",    "TX", 30.5052, -97.8203, "austin-tx"],
  ["georgetown-tx",    "Georgetown",    "TX", 30.6333, -97.6781, "austin-tx"],
  ["san-marcos-tx",    "San Marcos",    "TX", 29.8833, -97.9414, "austin-tx"],
  ["katy-tx",          "Katy",          "TX", 29.7858, -95.8245, "houston-tx"],
  ["the-woodlands-tx", "The Woodlands", "TX", 30.1658, -95.4613, "houston-tx"],
  ["sugar-land-tx",    "Sugar Land",    "TX", 29.6197, -95.6349, "houston-tx"],
  ["plano-tx",         "Plano",         "TX", 33.0198, -96.6989, "dallas-tx"],
  ["frisco-tx",        "Frisco",        "TX", 33.1507, -96.8236, "dallas-tx"],
  ["mckinney-tx",      "McKinney",      "TX", 33.1972, -96.6398, "dallas-tx"],
  ["arlington-tx",     "Arlington",     "TX", 32.7357, -97.1081, "dallas-tx"],
  ["new-braunfels-tx", "New Braunfels", "TX", 29.7030, -98.1245, "san-antonio-tx"],
  ["bryan-tx",         "Bryan",         "TX", 30.6744, -96.3698, "college-station-tx"],
];

async function main() {
  console.log("Seeding metros...");

  // Upsert major metros first (no parent)
  const majorMap: Record<string, string> = {};
  for (const m of MAJOR_METROS) {
    const record = await prisma.metro.upsert({
      where: { slug: m.slug },
      update: { name: m.name, state: m.state, latitude: m.latitude, longitude: m.longitude },
      create: { slug: m.slug, name: m.name, state: m.state, latitude: m.latitude, longitude: m.longitude },
    });
    majorMap[m.slug] = record.id;
    console.log(`  ✓ ${m.name}, ${m.state} (major)`);
  }

  // Upsert child metros with parentMetroId
  for (const [slug, name, state, latitude, longitude, parentSlug] of CHILD_METROS) {
    const parentId = majorMap[parentSlug];
    if (!parentId) {
      console.warn(`  ✗ Parent metro not found for ${name}: ${parentSlug}`);
      continue;
    }
    await prisma.metro.upsert({
      where: { slug },
      update: { name, state, latitude, longitude, parentMetroId: parentId },
      create: { slug, name, state, latitude, longitude, parentMetroId: parentId },
    });
    console.log(`  ✓ ${name}, ${state} → ${parentSlug}`);
  }

  console.log(`\nDone. ${MAJOR_METROS.length} major metros, ${CHILD_METROS.length} child metros.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
