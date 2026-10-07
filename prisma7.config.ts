import "dotenv/config";
import { defineConfig } from "prisma/config";
import { assertNotProductionHost } from "./scripts/db-host-guard.mjs";

// `prisma generate` does not connect. Migration commands, seed, and studio do.
// Production (NODE_ENV=production) may use the production host, which is what Vercel does.
const prismaCommand = process.argv[2];
if (prismaCommand !== "generate") assertNotProductionHost();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations run as the owner role over a direct connection. The app and the seed use
    // DATABASE_URL (the restricted app role), which cannot run DDL.
    url: process.env.DIRECT_URL,
  },
});
