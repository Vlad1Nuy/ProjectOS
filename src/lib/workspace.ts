import { z } from "zod";

export const statuses = ["BACKLOG", "READY", "IN PROGRESS", "BLOCKED", "REVIEW", "DONE", "CANCELLED"] as const;
export const memoryFiles = ["PROJECT.md", "MASTER_PROMPT.md", "DECISIONS.md", "RISKS.md", "CHANGELOG.md", "README.md", "TASKS.md"] as const;
export type MemoryFile = typeof memoryFiles[number];
const id = z.string().uuid();
const text = z.string().max(20000);
const projectSchema = z.object({
  id, name: z.string().trim().min(1).max(100), description: text,
  goal: text, category: z.string().max(50), color: z.enum(["teal", "blue", "purple", "orange", "pink"]),
  status: z.enum(["Active", "On hold", "Completed", "Archived"]), stage: z.string().max(60),
  createdAt: z.string().datetime(), memory: z.record(z.enum(memoryFiles), text),
});
const taskSchema = z.object({
  id, projectId: id, title: z.string().trim().min(1).max(200), description: text,
  priority: z.enum(["High", "Medium", "Low"]), status: z.enum(statuses), criterion: z.string().max(2000),
  confirmed: z.boolean(), dependencies: z.array(id).max(100), createdAt: z.string().datetime(),
});
const activitySchema = z.object({ id, projectId: id.nullable(), title: z.string().max(300), detail: z.string().max(300), type: z.enum(["project", "task", "memory", "system"]), createdAt: z.string().datetime() });
export const workspaceSchema = z.object({
  version: z.literal(2), name: z.string().trim().min(1).max(80), sample: z.boolean(),
  projects: z.array(projectSchema).max(200), tasks: z.array(taskSchema).max(5000), activity: z.array(activitySchema).max(1000),
}).superRefine((w, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  const projects = new Set(w.projects.map(p => p.id));
  const tasks = new Map(w.tasks.map(t => [t.id, t]));
  if (projects.size !== w.projects.length || tasks.size !== w.tasks.length) fail("Duplicate IDs are not allowed.");
  for (const task of w.tasks) {
    if (!projects.has(task.projectId)) fail("A task must belong to an existing project.");
    if (task.status === "DONE" && (!task.confirmed || !task.criterion.trim())) fail("Confirm a written completion criterion before marking a task done.");
    for (const dep of task.dependencies) {
      if (!tasks.has(dep) || dep === task.id || tasks.get(dep)?.projectId !== task.projectId) fail("Dependencies must refer to other tasks in the same project.");
      if (task.status === "DONE" && tasks.get(dep)?.status !== "DONE") fail("Complete dependencies first.");
    }
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (key: string): boolean => {
    if (visiting.has(key)) return false;
    if (visited.has(key)) return true;
    visiting.add(key);
    for (const dep of tasks.get(key)?.dependencies ?? []) if (!visit(dep)) return false;
    visiting.delete(key); visited.add(key); return true;
  };
  for (const task of w.tasks) if (!visit(task.id)) { fail("Circular task dependencies are not allowed."); break; }
});
export type Workspace = z.infer<typeof workspaceSchema>;
export type Project = Workspace["projects"][number];
export type Task = Workspace["tasks"][number];
export type Activity = Workspace["activity"][number];
export function emptyMemory(name: string): Project["memory"] {
  return { "PROJECT.md": `## Project notes\n\nA focused space for ${name}.`, "MASTER_PROMPT.md": "You are my project partner. Separate facts from assumptions. Suggest the smallest useful next step. Never mark a task done without checking its completion criterion.", "DECISIONS.md": "# Decisions\n\nRecord the decision, date, and reasoning here.", "RISKS.md": "# Risks\n\nRecord risks, their impact, and mitigation here.", "CHANGELOG.md": "", "README.md": `# ${name}\n\n## Getting started\n\nKeep useful links and instructions here.`, "TASKS.md": "" };
}
export function fileContent(w: Workspace, p: Project, file: MemoryFile) {
  if (file === "PROJECT.md") return `# ${p.name}\n\n${p.description}\n\n## Goal\n${p.goal || "Not set"}\n\n## Current state\nStatus: ${p.status}\nStage: ${p.stage}\nCategory: ${p.category}\n\n${p.memory[file]}`;
  if (file === "TASKS.md") return `# Tasks — ${p.name}\n\n` + w.tasks.filter(t => t.projectId === p.id).map(t => `- [${t.status === "DONE" ? "x" : " "}] ${t.title}\n  Status: ${t.status} | Priority: ${t.priority}\n  Completion criterion: ${t.criterion || "Not set"}\n  ${t.description}\n  Dependencies: ${t.dependencies.map(d => w.tasks.find(x => x.id === d)?.title ?? d).join(", ") || "None"}`).join("\n\n");
  if (file === "CHANGELOG.md") return `# Changelog — ${p.name}\n\n` + w.activity.filter(a => a.projectId === p.id || a.projectId === null).slice(0, 30).map(a => `- ${a.createdAt.slice(0, 10)} · ${a.title} — ${a.detail}`).join("\n");
  return p.memory[file];
}
export function makeContext(w: Workspace, p: Project, files: MemoryFile[], request: string) {
  return `# Project OS · AI Context\nGenerated: ${new Date().toISOString()}\nProject: ${p.name}\nGoal: ${p.goal}\nState: ${p.status} / ${p.stage}\n\nUse the following as current project context. Distinguish FACT, INFERENCE, ASSUMPTION, and HYPOTHESIS. Do not claim unverified work is complete.\n\n${files.map(f => `--- ${f} ---\n${fileContent(w, p, f)}`).join("\n\n")}\n\n## Current request\n${request || "Review the current state and recommend the next useful step."}`;
}
export function seedWorkspace(): Workspace {
  const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const now = Date.now();
  const date = (hours: number) => new Date(now - hours * 3600000).toISOString();
  const projects: Project[] = [
    { id: uid(1), name: "Project OS V2", description: "A calmer, more reliable home for all my projects.", goal: "Build a reliable local tool to think, plan, and move projects forward.", category: "Development", color: "teal", status: "Active", stage: "Building", createdAt: date(240), memory: emptyMemory("Project OS V2") },
    { id: uid(2), name: "Personal website", description: "A little corner of the internet that feels like me.", goal: "Publish a thoughtful portfolio of my work.", category: "Design", color: "blue", status: "Active", stage: "Designing", createdAt: date(200), memory: emptyMemory("Personal website") },
    { id: uid(3), name: "Knowledge base", description: "Turn scattered notes into connected knowledge.", goal: "Create one trusted place for ideas, notes, and things I learn.", category: "Personal", color: "purple", status: "Active", stage: "Planning", createdAt: date(160), memory: emptyMemory("Knowledge base") },
    { id: uid(4), name: "Learning roadmap", description: "Make room for a little progress, every week.", goal: "Build a consistent and practical learning habit.", category: "Learning", color: "orange", status: "On hold", stage: "Exploring", createdAt: date(120), memory: emptyMemory("Learning roadmap") },
  ];
  projects[0].memory["DECISIONS.md"] = "# Decisions\n\n## Local-first, always\nKeep PostgreSQL as the source of truth. No cloud account is required.\n\n## Manual AI context\nUse regular ChatGPT with curated Markdown. An API subscription is not necessary.";
  projects[0].memory["RISKS.md"] = "# Risks\n\n## Windows launch is not yet verified on a real Windows PC\nRun the acceptance checklist before relying on daily desktop launch.\n\n## Backups\nExport a workspace copy before updating the application.";
  const entries: [string, number, Task["status"], Task["priority"]][] = [
    ["Set up Windows desktop launcher", 1, "IN PROGRESS", "High"],
    ["Design the homepage layout", 2, "IN PROGRESS", "Medium"],
    ["Define the memory file structure", 3, "READY", "Medium"],
    ["Validate workspace import & export", 1, "REVIEW", "High"],
    ["Resolve database connection on startup", 1, "BLOCKED", "High"],
    ["Write the first case study", 2, "READY", "Medium"],
    ["Organize existing notes", 3, "BACKLOG", "Low"],
    ["Document the local setup", 1, "IN PROGRESS", "Medium"],
    ["Choose a typography direction", 2, "DONE", "Medium"],
    ["Create the project foundation", 1, "DONE", "High"],
    ["Define workspace principles", 1, "DONE", "Medium"],
    ["Collect design references", 2, "DONE", "Low"],
    ["Choose a note format", 3, "DONE", "Medium"],
    ["Review accessibility", 2, "BACKLOG", "Medium"],
    ["Add a weekly review template", 3, "READY", "Low"],
    ["Plan the next learning sprint", 4, "BACKLOG", "Low"],
  ];
  const tasks: Task[] = entries.map(([title, p, status, priority], i) => ({ id: uid(100 + i), projectId: uid(p), title, status, priority, description: "Sample task — edit this to fit your own workflow.", criterion: "The result has been reviewed and works as described.", confirmed: status === "DONE", dependencies: [], createdAt: date(48 + i) }));
  return { version: 2, name: "My workspace", sample: true, projects, tasks, activity: [
    { id: uid(501), projectId: uid(1), title: "Updated project memory", detail: "DECISIONS.md · Project OS V2", type: "memory", createdAt: date(0.2) },
    { id: uid(502), projectId: uid(2), title: "Completed a task", detail: "Choose a typography direction", type: "task", createdAt: date(1) },
    { id: uid(503), projectId: uid(1), title: "Moved a task to review", detail: "Validate workspace import & export", type: "task", createdAt: date(2) },
    { id: uid(504), projectId: uid(3), title: "Created a project", detail: "Knowledge base", type: "project", createdAt: date(4) },
    { id: uid(505), projectId: null, title: "Welcome to your workspace", detail: "Example projects added to help you get started", type: "system", createdAt: date(24) },
  ] };
}
