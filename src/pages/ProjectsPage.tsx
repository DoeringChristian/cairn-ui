import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Search, Upload, X } from "lucide-react";
import { useProjects } from "../api/hooks";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import ImportRunsDialog from "../components/ImportRunsDialog";
import ProjectCard from "../components/ProjectCard";
import "./projects.css";

const PAGE_SIZE = 24;

export default function ProjectsPage() {
  const query = useProjects();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const projects = query.data?.projects ?? [];
  const term = search.trim().toLocaleLowerCase();
  const filtered = projects.filter(project => `${project.name} ${project.id}`.toLocaleLowerCase().includes(term));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const items = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const find = (value: string) => { setSearch(value); setPage(0); };

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    if (!newName.trim() || saving) return;
    setSaving(true); setError("");
    try {
      const project = await api.createProject(newName.trim());
      await client.invalidateQueries({ queryKey: qk.projects() });
      navigate(`/p/${encodeURIComponent(project.id)}/reports`);
    } catch (cause) { setError(String(cause)); }
    finally { setSaving(false); }
  }

  return <section className="projects-page">
    <header className="projects-heading">
      <div><h1>Projects</h1><p>Reports, runs and artifacts, organized by project.</p></div>
      <div className="projects-actions">
        <button className="btn" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label="Refresh projects"><RefreshCw size={15} />Refresh</button>
        <button className="btn" onClick={() => setImportOpen(true)}><Upload size={15} />Import runs</button>
        <button className="btn projects-create" onClick={() => { setCreating(true); setError(""); }}><Plus size={15} />New project</button>
      </div>
    </header>
    {creating && <form className="projects-new" onSubmit={createProject}>
      <label htmlFor="new-project-name">Project name</label>
      <input id="new-project-name" autoFocus className="input" value={newName} onChange={event => setNewName(event.target.value)} placeholder="e.g. Vision experiments" onKeyDown={event => { if (event.key === "Escape") setCreating(false); }} />
      <button className="btn projects-create" disabled={!newName.trim() || saving}>{saving ? "Creating…" : "Create project"}</button>
      <button type="button" className="btn" disabled={saving} onClick={() => setCreating(false)}>Cancel</button>
      {error && <p role="alert">{error}</p>}
    </form>}
    <div className="projects-toolbar">
      <label className="projects-search"><Search size={17} aria-hidden="true" /><input aria-label="Find project" placeholder="Find a project…" value={search} onChange={event => find(event.target.value)} />
        {search && <button aria-label="Clear project search" onClick={() => find("")}><X size={15} /></button>}
      </label>
      <span className="projects-page-count" aria-live="polite">{query.isLoading ? "Loading projects…" : `${filtered.length} ${filtered.length === 1 ? "project" : "projects"}${filtered.length > PAGE_SIZE ? ` · page ${currentPage + 1}` : ""}`}</span>
    </div>
    {query.isError && <div role="alert" className="card p-5 mb-5">Could not load projects. <button className="btn" onClick={() => void query.refetch()}>Retry</button></div>}
    {query.isLoading ? <p className="text-fg-muted" role="status">Loading projects…</p> : items.length ? <div className="project-grid">{items.map(project => <ProjectCard key={project.id} project={project} />)}</div> : !query.isError && <div className="projects-empty card">
      <h2>{term ? "No matching projects" : "Your research starts here"}</h2>
      <p>{term ? `No projects match “${search.trim()}”.` : "Create a project for your reports and the experiments behind them."}</p>
      <button className="btn" onClick={() => term ? find("") : setCreating(true)}>{term ? "Clear search" : "Create a project"}</button>
      {!term && <details><summary>Start from Python</summary><pre>{`import cairn\n\ncairn.init(project="demo", repo="./.cairn")\ncairn.log({"loss": 0.5})\ncairn.finish()`}</pre></details>}
    </div>}
    {filtered.length > PAGE_SIZE && <nav className="projects-pagination" aria-label="Project pages"><button className="btn" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {Math.ceil(filtered.length / PAGE_SIZE)}</span><button className="btn" disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
    <ImportRunsDialog open={importOpen} onClose={() => { setImportOpen(false); void client.invalidateQueries({ queryKey: qk.projects() }); }} />
  </section>;
}
