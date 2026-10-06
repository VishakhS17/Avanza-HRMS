import "dotenv/config";
import { defineConfig } from "prisma/config";

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
