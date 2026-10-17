/** Project overview card adapted from Prism2's ProjectsLanding. */
import { Activity, ArrowUpRight, Boxes, Clock3, FileText, LayoutDashboard } from "lucide-react";
import { Link } from "react-router-dom";
import type { Project } from "../api/types";
import { formatRelative } from "../lib/format";

export default function ProjectCard({ project }: { project: Project }) {
  const name = project.name || project.id;
  const base = `/p/${encodeURIComponent(project.id)}`;
  const updated = project.last_activity_at || project.last_run_at;
  const validUpdated = updated && Number.isFinite(Date.parse(updated)) ? updated : null;
  const headingId = `project-${project.id}`;
  return <article className="project-card" aria-labelledby={headingId}>
    <header className="project-card-heading">
      <span className="project-initial" aria-hidden="true">{name[0]?.toUpperCase() || "P"}</span>
      {project.active_run_count > 0 && <span className="project-active"><span />{project.active_run_count} active {project.active_run_count === 1 ? "run" : "runs"}</span>}
    </header>
    <h2 id={headingId}><Link className="project-title" to={`${base}/reports`}>{name}<ArrowUpRight size={17} aria-hidden="true" /></Link></h2>
    {project.description && <p className="project-description">{project.description}</p>}
    <nav className="project-stat-links" aria-label={`${name} contents`}>
      <Link to={`${base}/reports`} aria-label={`${project.report_count ?? 0} reports in ${name}`}><FileText size={15} /><strong>{project.report_count === undefined ? "—" : project.report_count.toLocaleString()}</strong><span>Reports</span></Link>
      <Link to={`${base}/runs`} aria-label={`${project.run_count} runs in ${name}`}><Activity size={15} /><strong>{project.run_count.toLocaleString()}</strong><span>Runs</span></Link>
      <Link to={`${base}/artifacts`} aria-label={`Artifacts in ${name}`}><Boxes size={15} /><strong>{project.artifact_count === undefined ? "—" : project.artifact_count.toLocaleString()}</strong><span>Artifacts</span></Link>
    </nav>
    <footer className="project-card-footer">
      <div>{validUpdated && <span className="project-updated"><Clock3 size={12} /><time dateTime={validUpdated} title={new Date(validUpdated).toLocaleString()}>Updated {formatRelative(validUpdated)}</time></span>}
        {project.last_run_at && <span className="project-last-run">Last run {formatRelative(project.last_run_at)}</span>}</div>
      <Link className="project-workspace" to={`${base}/workspace`} aria-label={`Open ${name} workspace`}><LayoutDashboard size={13} />Workspace<ArrowUpRight size={13} /></Link>
    </footer>
  </article>;
}
