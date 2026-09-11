"use client";
import { useEffect, useRef, useState, type ReactNode, type FormEvent } from "react";
import { X, Check, Archive, Trash2, ArrowRight, FolderOpen } from "lucide-react";
import { emptyMemory, statuses, type Project, type Task } from "@/lib/workspace";

export function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("input, textarea, button, select")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const all = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []);
        const first = all[0], last = all[all.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20}/></button></div>{children}</div></div>;
}
export function ProjectForm({ project, busy, onSave, onClose, onArchive, onTasks, onMemory }: { project?: Project; busy: boolean; onSave: (p: Project) => Promise<void>; onClose: () => void; onArchive?: () => void; onTasks?: () => void; onMemory?: () => void }) {
  const [color, setColor] = useState<Project["color"]>(project?.color ?? "teal");
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const fd = new FormData(e.currentTarget); const name = String(fd.get("name")).trim();
    await onSave({ id: project?.id ?? crypto.randomUUID(), name, description: String(fd.get("description")), goal: String(fd.get("goal")), category: String(fd.get("category")), stage: String(fd.get("stage")), status: String(fd.get("status")) as Project["status"], color, createdAt: project?.createdAt ?? new Date().toISOString(), memory: project?.memory ?? emptyMemory(name) });
  };
  return <Modal title={project ? "Project details" : "Make room for your next idea"} subtitle={project ? "A clear purpose. A useful next step." : "Every great project starts with a little clarity."} onClose={onClose}>
    {project && <div className="project-shortcuts"><button className="button" onClick={onTasks}><FolderOpen size={15}/> View tasks <ArrowRight size={14}/></button><button className="text-button" onClick={onMemory}>Open project memory <ArrowRight size={14}/></button></div>}
    <form onSubmit={submit} className="editor-form"><label>Project name <span>*</span><input name="name" required maxLength={100} defaultValue={project?.name} placeholder="What are you working on?" autoFocus/></label><label>Description<textarea name="description" maxLength={20000} rows={2} defaultValue={project?.description} placeholder="The idea, in a sentence or two"/></label><label>Goal<textarea name="goal" maxLength={20000} rows={2} defaultValue={project?.goal} placeholder="What does success look like?"/></label><div className="form-grid"><label>Category<input name="category" maxLength={50} defaultValue={project?.category ?? "Personal"} list="categories"/><datalist id="categories"><option>Development</option><option>Design</option><option>Personal</option><option>Learning</option></datalist></label><label>Stage<input name="stage" maxLength={60} defaultValue={project?.stage ?? "Planning"}/></label><label>Status<select name="status" defaultValue={project?.status ?? "Active"}>{["Active", "On hold", "Completed", "Archived"].map(s => <option key={s}>{s}</option>)}</select></label><label>Project color<div className="color-options">{(["teal", "blue", "purple", "orange", "pink"] as const).map(c => <button key={c} type="button" className={`color-choice ${c} ${color === c ? "selected" : ""}`} onClick={() => setColor(c)} aria-label={`${c} color`} aria-pressed={color === c}>{color === c && <Check size={14}/>}</button>)}</div></label></div><div className="modal-actions">{project && project.status !== "Archived" && <button type="button" className="text-button muted" onClick={onArchive} disabled={busy}><Archive size={15}/> Archive</button>}<div className="action-spacer"/><button type="button" className="button" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy}>{busy ? "Saving…" : project ? "Save changes" : "Create project"}<ArrowRight size={15}/></button></div></form>
  </Modal>;
}
export function TaskForm({ task, projects, tasks, projectId, busy, onSave, onClose, onDelete }: { task?: Task; projects: Project[]; tasks: Task[]; projectId?: string; busy: boolean; onSave: (t: Task) => Promise<void>; onClose: () => void; onDelete?: () => void }) {
  const [status, setStatus] = useState<Task["status"]>(task?.status ?? "READY");
  const [selectedProject, setSelectedProject] = useState(task?.projectId ?? projectId ?? projects[0]?.id ?? "");
  const [deps, setDeps] = useState(task?.dependencies ?? []);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const fd = new FormData(e.currentTarget);
    await onSave({ id: task?.id ?? crypto.randomUUID(), title: String(fd.get("title")).trim(), description: String(fd.get("description")), projectId: selectedProject, status, priority: String(fd.get("priority")) as Task["priority"], criterion: String(fd.get("criterion")), confirmed: status === "DONE" && fd.get("confirmed") === "on", dependencies: deps, createdAt: task?.createdAt ?? new Date().toISOString() });
  };
  return <Modal title={task ? "Task details" : "One step closer"} subtitle="Keep it specific. Define what done really means." onClose={onClose}><form onSubmit={submit} className="editor-form"><label>Task name <span>*</span><input autoFocus required maxLength={200} name="title" defaultValue={task?.title} placeholder="What’s the next useful step?"/></label><label>Project<select required value={selectedProject} onChange={e => { setSelectedProject(e.target.value); setDeps([]); }}>{projects.map(p => <option value={p.id} key={p.id}>{p.name}{p.status === "Archived" ? " (archived)" : ""}</option>)}</select></label><label>Description<textarea name="description" maxLength={20000} rows={2} defaultValue={task?.description} placeholder="Helpful details, links, or context"/></label><div className="form-grid"><label>Status<select value={status} onChange={e => setStatus(e.target.value as Task["status"])}>{statuses.map(s => <option key={s}>{s}</option>)}</select></label><label>Priority<select name="priority" defaultValue={task?.priority ?? "Medium"}>{["High", "Medium", "Low"].map(s => <option key={s}>{s}</option>)}</select></label></div><label>Completion criterion {status === "DONE" && <span>*</span>}<textarea rows={2} name="criterion" maxLength={2000} required={status === "DONE"} defaultValue={task?.criterion} placeholder="I’ll know this is done when…"/></label>{status === "DONE" && <label className="check-field confirmation"><input type="checkbox" name="confirmed" required defaultChecked={task?.confirmed}/><span>I have checked the result and confirm the completion criterion is met.</span></label>}
    {tasks.some(t => t.projectId === selectedProject && t.id !== task?.id) && <details className="dependencies"><summary>Dependencies <span className="muted">({deps.length} selected)</span></summary><div>{tasks.filter(t => t.projectId === selectedProject && t.id !== task?.id).map(t => <label key={t.id} className="check-field"><input type="checkbox" checked={deps.includes(t.id)} onChange={e => setDeps(e.target.checked ? [...deps, t.id] : deps.filter(d => d !== t.id))}/><span>{t.title}</span></label>)}</div></details>}
    <div className="modal-actions">{task && <button className="text-button danger-text" type="button" onClick={onDelete} disabled={busy}><Trash2 size={15}/> Delete</button>}<div className="action-spacer"/><button className="button" type="button" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || !selectedProject}>{busy ? "Saving…" : task ? "Save changes" : "Create task"}<ArrowRight size={15}/></button></div></form></Modal>;
}
