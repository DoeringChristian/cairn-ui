import { useBlocker } from "react-router-dom";
import { createPortal } from "react-dom";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Check } from "lucide-react";
import { qk } from "../../../api/query-keys";
import { NotebookEditor, type NotebookEditorHandle, type NotebookEditorStatus } from "./NotebookEditor";
import { CodeEditor } from "./CodeEditor";
import { BuildDiagnostics } from "./BuildDiagnostics";
import { hasSourceChanges, saveSourceChanges, textFiles, type DraftFiles } from "./draft-save";
import { workspaceApi, type ReportWorkspace, type ReportBuild, type ReportPublication } from "./workspace-api";

export type ReportSourceWorkspaceHandle = {saveDraft: () => Promise<void>};
type Props = {
  reportId?: string;
  versionId?: string;
  documentUrl?: string;
  workspaceId?: string;
  actionsHost?: HTMLElement | null;
  onPublished?: (result: ReportPublication) => void;
};

/** One draft owner: both editors autosave; the report header owns publication. */
export const ReportSourceWorkspace = forwardRef<ReportSourceWorkspaceHandle, Props>(function ReportSourceWorkspace({reportId, versionId, documentUrl, workspaceId, actionsHost, onPublished}, ref) {
  const qc = useQueryClient();
  const opening = useRef<Promise<ReportWorkspace> | null>(null);
  const notebook = useRef<NotebookEditorHandle>(null);
  const [mode, setMode] = useState<"notebook" | "source">("notebook");
  const [notebookStatus, setNotebookStatus] = useState<NotebookEditorStatus>({dirty: false, saving: false, busy: false, running: false, ready: false, saveError: ""});
  const [workspace, setWorkspace] = useState<ReportWorkspace | null>(null);
  const [files, setFiles] = useState<DraftFiles>({});
  const workspaceRef = useRef(workspace), filesRef = useRef(files);
  const sourceSave = useRef<Promise<ReportWorkspace> | null>(null);
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState<ReportBuild | null>(null);
  const [preparing, setPreparing] = useState(false);
  const submitting = useRef(false);
  const completed = useRef(new Set<string>());
  const publicationCallback = useRef(onPublished);
  publicationCallback.current = onPublished;
  const running = !!job && ["queued", "running", "pending"].includes(job.status);
  const publishing = preparing || running;
  const acknowledge = (value: ReportWorkspace) => {
    workspaceRef.current = value;
    setWorkspace(value);
    return value;
  };
  const adopt = (value: ReportWorkspace) => {
    acknowledge(value);
    filesRef.current = textFiles(value);
    setFiles(filesRef.current);
    return value;
  };

  useEffect(() => {
    let stopped = false;
    const id = workspaceId || new URLSearchParams(window.location.search).get("workspace");
    if (!opening.current) opening.current = id ? workspaceApi.read(id) : reportId && versionId ? workspaceApi.copy(reportId, versionId) : Promise.reject(new Error("A draft workspace is required"));
    opening.current.then(value => {
      if (stopped) return;
      adopt(value); setSelected(value.entry);
      if (value.latest_build) {
        if (value.latest_build.status === "completed") completed.current.add(value.latest_build.id);
        setJob(value.latest_build);
      }
      const url = new URL(window.location.href); url.searchParams.set("workspace", value.id); window.history.replaceState(null, "", url);
    }).catch(value => {if (!stopped) setError(String(value));});
    return () => {stopped = true;};
    // Publication updates must not reload the draft from its opening promise.
  }, [reportId, workspaceId]);

  const dirty = mode === "notebook" ? notebookStatus.dirty : hasSourceChanges(workspace, files);
  const isSaving = saving || (mode === "notebook" && notebookStatus.saving);
  const hasUnsavedChanges = () => mode === "notebook"
    ? notebook.current?.hasUnsavedChanges() ?? false
    : hasSourceChanges(workspaceRef.current, filesRef.current);
  // Read refs so navigation immediately after an awaited save is allowed.
  const blocker = useBlocker(() => hasUnsavedChanges());

  function saveSource(): Promise<ReportWorkspace> {
    if (sourceSave.current) return sourceSave.current;
    setSaving(true);
    const task = saveSourceChanges(
      () => ({workspace: workspaceRef.current, files: filesRef.current}),
      acknowledge,
      workspaceApi.save,
    ).finally(() => {sourceSave.current = null; setSaving(false);});
    sourceSave.current = task;
    return task;
  }

  async function saveDraft(): Promise<void> {
    setError("");
    try {
      if (mode === "notebook") await notebook.current?.saveDraft();
      else await saveSource();
    } catch (value) {
      setError(String(value));
      throw value;
    }
  }
  useImperativeHandle(ref, () => ({saveDraft}));

  useEffect(() => {
    if (mode !== "source" || !dirty || saving || publishing || error) return;
    const timer = setTimeout(() => {void saveDraft().catch(() => {});}, 1000);
    return () => clearTimeout(timer);
  }, [mode, files, dirty, saving, publishing, error]);

  useEffect(() => {
    if (!running || !job) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await workspaceApi.status(job.id);
        if (stopped) return;
        setJob(value);
        if (["queued", "running", "pending"].includes(value.status)) timer = setTimeout(poll, 1000);
      } catch (value) {if (!stopped) {setError(String(value)); timer = setTimeout(poll, 3000);}}
    };
    timer = setTimeout(poll, 1000);
    return () => {stopped = true; clearTimeout(timer);};
  }, [job?.id, running]);

  useEffect(() => {
    if (job?.status !== "completed" || !job.result || completed.current.has(job.id)) return;
    completed.current.add(job.id);
    const result = job.result;
    void qc.invalidateQueries({queryKey: qk.report(result.project_id, result.id)});
    void qc.invalidateQueries({queryKey: qk.reports(result.project_id)});
    void qc.invalidateQueries({queryKey: qk.projects()});
    publicationCallback.current?.(result);
  }, [job, qc]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) {event.preventDefault(); event.returnValue = "";}
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [mode]);

  const refresh = async () => {if (workspaceRef.current) adopt(await workspaceApi.read(workspaceRef.current.id));};
  async function publish() {
    if (submitting.current || running || !workspaceRef.current) return;
    submitting.current = true; setPreparing(true); setError(""); setJob(null);
    try {
      await saveDraft();
      const current = adopt(await workspaceApi.read(workspaceRef.current!.id));
      setJob(await workspaceApi.build(current.id, current.revision));
    } catch (value) {setError(String(value));}
    finally {submitting.current = false; setPreparing(false);}
  }
  async function switchMode(next: "notebook" | "source") {
    if (next === mode || switching || publishing) return;
    setSwitching(true);
    try {await saveDraft(); if (mode === "notebook") await refresh(); setMode(next);}
    catch { /* Keep the current editor and unsaved text visible. */ }
    finally {setSwitching(false);}
  }

  const actions = <div className="flex flex-wrap items-center gap-3" aria-label="Draft actions">
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted" role="status" aria-live="polite">
      {isSaving ? <LoaderCircle size={13} className="animate-spin"/> : !dirty && workspace ? <Check size={13} className="text-accent"/> : null}
      {!workspace ? "Opening draft…" : isSaving ? "Saving draft…" : dirty ? "Unsaved changes" : "Draft saved"}
    </span>
    {dirty && (error || notebookStatus.saveError) && <button className="btn text-xs" onClick={() => void saveDraft().catch(() => {})}>Retry save</button>}
    <button className="btn btn-primary" title="Save the draft, run the report, and publish a new version" disabled={!workspace || publishing || switching || (mode === "notebook" && (!notebookStatus.ready || notebookStatus.running || (notebookStatus.busy && !notebookStatus.saving)))} onClick={() => void publish()}>
      {publishing && <LoaderCircle size={14} className="animate-spin"/>}{publishing ? "Publishing…" : "Publish"}
    </button>
  </div>;

  return <section className="cairn-source-workspace min-w-0">
    {actionsHost ? createPortal(actions, actionsHost) : <div className="mb-4 flex justify-end">{actions}</div>}
    {blocker.state === "blocked" && <div role="alertdialog" aria-label="Unsaved report source" className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"><div className="rounded border border-border bg-bg-elevated p-6 max-w-md"><h2 className="text-xl">Unsaved source changes</h2><p className="my-3">Save your draft before leaving.</p><div className="flex flex-wrap gap-3"><button className="btn" onClick={() => blocker.reset()}>Keep editing</button><button className="btn" disabled={isSaving} onClick={() => void saveDraft().then(() => blocker.proceed()).catch(() => {})}>Save and leave</button><button className="btn" onClick={() => blocker.proceed()}>Discard and leave</button></div></div></div>}
    {error && <p role="alert" className="mt-3 text-status-failed">{error}</p>}
    {!workspace && <p>Opening report editor…</p>}
    {workspace && <>
      {(preparing || job) && <div className="mb-4 rounded border border-border bg-bg-elevated px-4 py-3 text-sm" role={job?.status === "failed" ? "alert" : "status"} aria-live="polite">
        <div className="flex flex-wrap items-center gap-2">
          {publishing && <LoaderCircle size={15} className="animate-spin text-accent"/>}
          {job?.status === "completed" && <Check size={15} className="text-accent"/>}
          <span>{preparing ? "Preparing publication…" : job?.status === "queued" ? "Publication queued…" : job?.status === "running" ? "Building and publishing report…" : job?.status === "completed" ? "New version published." : job?.status === "failed" ? "Publication failed." : String("Publication " + job?.status + ".")}</span>
        </div>
        {job?.error && <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-status-failed">{job.error.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")}</pre>}
        {job && ["failed", "cancelled"].includes(job.status) && <BuildDiagnostics buildId={job.id}/>}
      </div>}
      <div className="flex gap-1 mb-4" role="tablist" aria-label="Editor view">
        <button className="btn" role="tab" aria-selected={mode === "notebook"} disabled={switching || publishing} onClick={() => void switchMode("notebook")}>Notebook</button>
        <button className="btn" role="tab" aria-selected={mode === "source"} disabled={switching || publishing} onClick={() => void switchMode("source")}>Source files</button>
      </div>
      {mode === "notebook" ? <NotebookEditor ref={notebook} documentUrl={documentUrl} workspaceId={workspace.id} onStatusChange={setNotebookStatus} onSaved={refresh} publishing={publishing} /> : <>
        <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Report source files">{workspace.files.map(file => <button key={file.path} role="tab" aria-selected={selected === file.path} className="btn text-xs" onClick={() => setSelected(file.path)}>{file.path}{file.text === null ? " (binary)" : ""}</button>)}</div>
        {workspace.files.filter(file => file.text !== null).map(file => <div key={file.path} hidden={selected !== file.path}><CodeEditor label={"Source: " + file.path} value={files[file.path] || ""} language={file.path.endsWith(".py") ? "python" : /\.ya?ml$/.test(file.path) ? "yaml" : "markdown"} readOnly={publishing || switching} onChange={value => {filesRef.current = {...filesRef.current, [file.path]: value}; setFiles(filesRef.current); setError("");}} onSave={() => {void saveDraft().catch(() => {});}} /></div>)}
        {files[selected] === undefined && <p>This binary resource is preserved in the report.</p>}
      </>}
    </>}
  </section>;
});
