import { db } from "@/db";
import { sql } from "drizzle-orm";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const result = await db.execute(sql`select (to_regclass('public.project_os_workspaces') is not null and to_regclass('public.project_os_backups') is not null) as schema_ready`);
    return Response.json({ ok: true, app: "project-os", database: "connected", instance: process.env.PROJECT_OS_INSTANCE ?? null, schemaReady: result.rows[0]?.schema_ready === true }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ ok: false, app: "project-os", database: "unavailable", schemaReady: false }, { status: 503 }); }
}
