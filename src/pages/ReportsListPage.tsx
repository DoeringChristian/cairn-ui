import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Plus, RefreshCw, Search, X } from "lucide-react";
import { useReports } from "../api/hooks";
import { ReportCard } from "../components/reports/ReportCard";
import "./reports-list.css";

const PAGE_SIZE = 24;
export default function ReportsListPage() {
  const { projectId = "" } = useParams();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const query = useReports(projectId, { limit: PAGE_SIZE, offset });
  const reports = query.data?.reports ?? [];
  const visible = reports.filter(report => report.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <section className="reports-list-page">
    <header className="reports-list-heading"><div><h1>Reports</h1><p>Executable research, pinned evidence, and the experiments behind it.</p></div><div className="flex gap-2"><Link className="btn btn-primary" to={`/p/${encodeURIComponent(projectId)}/reports/new`}><Plus size={15} />New report</Link><button className="btn" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={15} />Refresh</button></div></header>
    <div className="reports-searchbar"><label><Search size={17} aria-hidden="true" /><input aria-label="Search reports on this page" placeholder="Find a report on this page…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button aria-label="Clear report search" onClick={() => setSearch("")}><X size={15} /></button>}</label></div>
    <div className="reports-section-title"><h2>Your reports</h2><span aria-live="polite">{query.isLoading ? "Loading…" : `${visible.length} on this page · ${query.data?.total ?? 0} total`}</span></div>
    {query.isError && <div className="card p-5 mb-5" role="alert">Could not load reports. <button className="btn" onClick={() => void query.refetch()}>Retry</button></div>}
    {query.isLoading ? <p role="status" className="text-fg-muted">Loading reports…</p> : visible.length ? <div className="report-grid">{visible.map(report => <ReportCard key={report.id} report={report} projectId={projectId} />)}</div> : !query.isError && <div className="reports-empty card"><h2>{search ? "No matching reports on this page" : "Your first report"}</h2><p>{search ? "Try another name, or browse the other pages." : "Create a report, write Markdown and Python in your browser, and publish a version with its evidence."}</p>{search ? <button className="btn" onClick={() => setSearch("")}>Clear search</button> : <Link className="btn btn-primary" to={`/p/${encodeURIComponent(projectId)}/reports/new`}>Create your first report</Link>}</div>}
    {(offset > 0 || offset + reports.length < (query.data?.total ?? 0)) && <nav className="reports-pagination" aria-label="Report pages"><button className="btn" disabled={offset === 0 || query.isFetching} onClick={() => { setOffset(Math.max(0, offset-PAGE_SIZE)); setSearch(""); }}>Previous</button><span>Page {Math.floor(offset/PAGE_SIZE)+1}</span><button className="btn" disabled={offset+reports.length >= (query.data?.total ?? 0) || query.isFetching} onClick={() => { setOffset(offset+PAGE_SIZE); setSearch(""); }}>Next</button></nav>}
    <details className="reports-write"><summary>Publish from the command line</summary><p>Create <code>reports/study/report.qmd</code>, then build and publish it:</p><pre>{`cairn report new study\ncairn report publish study --project ${projectId}`}</pre><p>Declare runs and artifact versions as inputs to connect the page to its evidence.</p></details>
  </section>;
}
