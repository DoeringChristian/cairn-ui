import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ReportSourceWorkspace } from "../components/reports/native/ReportSourceWorkspace";
import { workspaceApi } from "../components/reports/native/workspace-api";
import { createDraftRequest } from "../components/reports/native/new-report-draft";

export default function NewReportPage() {
  const navigate = useNavigate();
  const { projectId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const workspaceId = params.get("workspace");
  const request = useRef<ReturnType<typeof createDraftRequest<Awaited<ReturnType<typeof workspaceApi.create>>>> | null>(null);
  if (!request.current) request.current = createDraftRequest(workspaceApi.create);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  const reportsUrl = `/p/${encodeURIComponent(projectId)}/reports`;

  useEffect(() => {
    if (workspaceId) return;
    let active = true;
    setError("");
    // Reuse the promise when StrictMode replays the effect. Only the active
    // subscription updates navigation; refresh then opens the saved workspace.
    request.current!(projectId).then(workspace => {
      if (active) setParams({workspace: workspace.id}, {replace: true});
    }).catch(value => {
      if (active) setError(value instanceof Error ? value.message : String(value));
    });
    return () => { active = false; };
  }, [projectId, workspaceId, attempt, setParams]);

  return <section className="min-w-0 max-w-6xl mx-auto">
    <Link className="inline-flex items-center gap-2 text-sm text-fg-muted mb-5" to={reportsUrl}><ArrowLeft size={15}/>Reports</Link>
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3"><h1 className="text-3xl font-serif">NewReport</h1><div ref={setActionsHost}/></header>
    {workspaceId ? <ReportSourceWorkspace actionsHost={actionsHost} key={workspaceId} workspaceId={workspaceId} onPublished={result => navigate(`${result.url}?tab=edit&workspace=${encodeURIComponent(workspaceId)}&version=${encodeURIComponent(result.version_id)}`, {replace:true})}/> :
      error ? <div className="card p-6"><p role="alert" className="text-status-failed">{error}</p><button className="btn mt-4" onClick={() => setAttempt(value => value + 1)}>Try again</button></div> :
      <p role="status" className="text-fg-muted">Opening your draft…</p>}
  </section>;
}
