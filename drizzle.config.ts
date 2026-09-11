import "dotenv/config";
import { defineConfig } from "drizzle-kit";
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL in your .env file before running Drizzle.");
export default defineConfig({ dialect: "postgresql", schema: "./src/db/schema.ts", out: "./drizzle", dbCredentials: { url: process.env.DATABASE_URL } });
