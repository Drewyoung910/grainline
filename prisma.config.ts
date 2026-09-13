import { defineConfig } from "prisma/config";

// prisma.config.ts — required for Prisma 7
// url: direct (non-pooled) connection used by migrate and introspection commands
// The PrismaClient runtime uses the pooled DATABASE_URL via the pg adapter in src/lib/db.ts
export default defineConfig({
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
