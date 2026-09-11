import { db } from "@/db";
import { workspaces, backups } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { seedWorkspace, workspaceSchema, type Workspace, type Activity } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const inputSchema = z.object({ revision: z.number().int().min(0), data: workspaceSchema, restore: z.boolean().optional() });
async function load() {
  await db.insert(workspaces).values({ id: "local", data: seedWorkspace() }).onConflictDoNothing();
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, "local"));
  return row;
}
export async function GET() {
  try {
    const row = await load();
    return Response.json({ data: row.data, revision: row.revision }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Workspace unavailable. Check PostgreSQL and apply the database schema with npx drizzle-kit push." }, { status: 503 });
  }
}
function events(before: Workspace, after: Workspace): Activity[] {
  const results: Activity[] = [];
  const add = (type: Activity["type"], title: string, detail: string, projectId: string | null) => results.push({ id: crypto.randomUUID(), type, title, detail: detail.slice(0, 300), projectId, createdAt: new Date().toISOString() });
  for (const p of after.projects) {
    const old = before.projects.find(x => x.id === p.id);
    if (!old) add("project", "Created a project", p.name, p.id);
    else if (JSON.stringify(old.memory) !== JSON.stringify(p.memory)) add("memory", "Updated project memory", `${Object.keys(p.memory).filter(k => old.memory[k as keyof typeof old.memory] !== p.memory[k as keyof typeof p.memory]).join(", ")} · ${p.name}`, p.id);
    else if (JSON.stringify(old) !== JSON.stringify(p)) add("project", p.status === "Archived" ? "Archived a project" : "Updated a project", p.name, p.id);
  }
  for (const p of before.projects) if (!after.projects.some(x => x.id === p.id)) add("project", "Removed a project", p.name, null);
  for (const t of after.tasks) {
    const old = before.tasks.find(x => x.id === t.id);
    if (!old) add("task", "Created a task", t.title, t.projectId);
    else if (JSON.stringify(old) !== JSON.stringify(t)) add("task", old.status !== t.status ? (t.status === "DONE" ? "Completed a task" : `Moved a task to ${t.status.toLowerCase()}`) : "Updated a task", t.title, t.projectId);
  }
  for (const t of before.tasks) if (!after.tasks.some(x => x.id === t.id)) add("task", "Deleted a task", t.title, after.projects.some(p => p.id === t.projectId) ? t.projectId : null);
  if (before.name !== after.name) add("system", "Renamed workspace", after.name, null);
  return results;
}
export async function PUT(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    try { if (new URL(origin).host !== request.headers.get("host")) return Response.json({ error: "Cross-origin writes are not allowed." }, { status: 403 }); }
    catch { return Response.json({ error: "Invalid request origin." }, { status: 403 }); }
  }
  if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "Expected application/json." }, { status: 415 });
  let body: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Empty body");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 3_000_000) { await reader.cancel(); return Response.json({ error: "Workspace exceeds the 3 MB limit." }, { status: 413 }); } chunks.push(value); }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return Response.json({ error: "Invalid JSON backup or request." }, { status: 400 }); }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Invalid workspace." }, { status: 400 });
  try {
    const result = await db.transaction(async tx => {
      const [current] = await tx.select().from(workspaces).where(eq(workspaces.id, "local")).for("update");
      if (!current || current.revision !== parsed.data.revision) return null;
      const next = parsed.data.data;
      if (parsed.data.restore) {
        await tx.insert(backups).values({ data: current.data });
        next.activity = [{ id: crypto.randomUUID(), projectId: null, title: "Restored workspace", detail: "Previous state backed up automatically", type: "system" as const, createdAt: new Date().toISOString() }, ...next.activity].slice(0, 1000);
      } else {
        next.activity = [...events(current.data, next), ...current.data.activity].slice(0, 1000);
      }
      const [updated] = await tx.update(workspaces).set({ data: next, revision: current.revision + 1, updatedAt: new Date() }).where(eq(workspaces.id, "local")).returning();
      return { data: updated.data, revision: updated.revision };
    });
    if (!result) return Response.json({ error: "This workspace changed in another tab. Reload before saving; your current edits have not been written." }, { status: 409 });
    return Response.json(result);
  } catch { return Response.json({ error: "Could not save. Your previous workspace is unchanged. Check the database connection and try again." }, { status: 503 }); }
}
