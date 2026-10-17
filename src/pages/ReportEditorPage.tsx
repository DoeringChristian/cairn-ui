import { BookOpen, Pencil } from "lucide-react";
import "../components/reports/native/report-card.css";
import { useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useReport } from "../api/hooks";
import { DeleteReportAction } from "../components/reports/DeleteReportAction";
import { ReportFiles } from "../components/reports/native/ReportFiles";
import { ReportHistory } from "../components/reports/native/ReportHistory";
import { ReportSourceWorkspace, type ReportSourceWorkspaceHandle } from "../components/reports/native/ReportSourceWorkspace";
import { DocumentRenderer } from "../components/reports/native/DocumentRenderer";
import { workspaceApi } from "../components/reports/native/workspace-api";

export default function ReportEditorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId = "", reportId = "" } = useParams();
  const [showSource, setShowSource] = useState(false);
  const [error, setError] = useState("");
  const editor = useRef<ReportSourceWorkspaceHandle>(null);
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  const [switching, setSwitching] = useState(false);
  const q = useReport(projectId, reportId);
  if (q.isLoading) return <p>Loading report…</p>;
  if (q.isError || !q.data) return <p role="alert">Could not load this report.</p>;
  const current = q.data.payload.compiled as {entry: string; version_id: string; slug: string} | undefined;
  if (!current) return <p role="alert">This report has no published build.</p>;
  const params = new URLSearchParams(location.search);
  const versionId = params.get("version") || current.version_id;
  const editing = params.get("tab") === "edit";
  const url = `/api/reports/${encodeURIComponent(reportId)}/builds/${encodeURIComponent(versionId)}/${current.entry.split("/").map(encodeURIComponent).join("/")}`;
  const tab = async (value: string) => {
    if (switching || (value === "edit") === editing) return;
    setSwitching(true); setError("");
    try {
      if (editing) await editor.current?.saveDraft();
      const next = new URLSearchParams(window.location.search); next.set("tab", value);
      navigate(`${location.pathname}?${next}`);
    } catch (value) {setError(String(value));}
    finally {setSwitching(false);}
  };
  const fork = async () => {setError("");try {const workspace = await workspaceApi.copy(reportId,versionId,true); navigate(`${location.pathname}?tab=edit&workspace=${encodeURIComponent(workspace.id)}&version=${encodeURIComponent(versionId)}`);} catch(error) {setError(String(error));}};
  return <article className="min-w-0 max-w-full">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 mb-5">
      <div className="flex items-center gap-4"><Link className="text-sm text-fg-muted" to={`/p/${projectId}/reports`}>← Reports</Link><div className="report-view-toggle" role="tablist" aria-label="Report view"><button role="tab" aria-selected={!editing} className="btn" aria-label="Read" title="Read published report; draft changes are saved separately" disabled={switching} onClick={() => void tab("reader")}><BookOpen size={16}/></button><button role="tab" aria-selected={editing} className="btn" aria-label="Edit" title="Edit report" disabled={switching} onClick={() => void tab("edit")}><Pencil size={16}/></button></div></div>
      <div className="flex flex-wrap items-center gap-2 min-w-0"><div ref={setActionsHost}/><ReportHistory reportId={reportId} versionId={versionId} onChange={version => navigate(`${location.pathname}?version=${encodeURIComponent(version)}`)} /><details className="relative"><summary className="btn cursor-pointer" aria-label="Report actions">•••</summary><div className="absolute right-0 z-20 w-64 rounded border border-border bg-bg-elevated p-4 flex flex-col items-start gap-3 text-sm"><ReportFiles reportId={reportId} versionId={versionId} /><a href={url} download={`${q.data.name}.html`}>Export HTML</a><a href={`/api/reports/${encodeURIComponent(reportId)}/bundle?version_id=${encodeURIComponent(versionId)}`} download>Download report bundle</a><button onClick={() => setShowSource(!showSource)}>{showSource ? "Hide" : "Show"} source references</button><button onClick={() => void fork()}>Make a copy</button></div></details><DeleteReportAction projectId={projectId} reportId={reportId} versionId={current.version_id} name={q.data.name} onDeleted={() => navigate(`/p/${projectId}/reports`)} /></div>
    </header>
    {error && <p role="alert">{error}</p>}
    {editing ? <ReportSourceWorkspace ref={editor} actionsHost={actionsHost} key={params.get("workspace") || `${reportId}:${versionId}`} reportId={reportId} versionId={versionId} documentUrl={url.replace(/[^/]+$/, "document.json")} onPublished={result => {
      const next = new URLSearchParams(window.location.search); next.set("version", result.version_id); next.set("tab", "edit");
      navigate(`${location.pathname}?${next}`, {replace: true});
    }} /> : <DocumentRenderer reportSlug={current.slug} projectId={projectId} reportId={reportId} versionId={versionId} title={q.data.name} url={url.replace(/[^/]+$/, "document.json")} fallbackUrl={url} showSource={showSource} />}
  </article>;
}
