import { pgTable, text, integer, jsonb, timestamp, serial } from "drizzle-orm/pg-core";
import type { Workspace } from "@/lib/workspace";

export const workspaces = pgTable("project_os_workspaces", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  data: jsonb("data").$type<Workspace>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const backups = pgTable("project_os_backups", {
  id: serial("id").primaryKey(),
  data: jsonb("data").$type<Workspace>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
