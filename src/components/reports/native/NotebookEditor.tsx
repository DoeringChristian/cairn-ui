import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Play,
  Code2,
  FileText,
  Undo2,
} from "lucide-react";
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {...options, headers: {"Content-Type": "application/json", ...options?.headers}});
  const value = await response.json(); if (!response.ok) throw new Error(typeof value.detail === "string" ? value.detail : `Request failed (${response.status})`); return value;
}

function Callout({children}: {children: React.ReactNode; error?: boolean}) {return <p role="alert">{children}</p>;}
function Loading() {return <p>Opening notebook…</p>;}
import { CodeEditor } from "./CodeEditor";
import { EMPTY_REPORT_CELL } from "./new-report-draft";

import {
  Markdown,
  OutputView,
  DocumentContext,
  type Output,
  type DocumentDefinition,

} from "./DocumentRenderer";
import "./notebook.css";
type Cell = {
  id: string;
  index: number;
  type: "markdown" | "code" | "card" | "metadata";
  source: string;
  file: string;
  line: number;
  end_line: number;
  hash: string;
  outputs?: Output[];
  status?: string;
  execution_count?: number;
  cache_key?: string;
};
type Notebook = {
  draft_id: string;
  source_ref: string;
  entry?: string;
  hash?: string;
  cells: Cell[];
};
type Job = {
  id: string;
  state: string;
  error?: string;
  cells?: Cell[];
  cache_hit?: boolean;
};
export type NotebookEditorHandle = { saveDraft: () => Promise<void>; hasUnsavedChanges: () => boolean };
export type NotebookEditorStatus = {dirty: boolean; saving: boolean; busy: boolean; running: boolean; ready: boolean; saveError: string};
export const NotebookEditor = forwardRef<NotebookEditorHandle, {workspaceId: string; documentUrl?: string; onStatusChange: (status: NotebookEditorStatus) => void; onSaved: () => Promise<void>; publishing?: boolean}>(function NotebookEditor({workspaceId, documentUrl, onStatusChange, onSaved, publishing = false}, ref) {
  const [definition,setDefinition] = useState<DocumentDefinition | null>(null);
  useEffect(() => {if (!documentUrl) return; const controller = new AbortController(); fetch(documentUrl,{signal:controller.signal}).then(async response => {if (!response.ok) return null; return response.json();}).then(value => {if(value)setDefinition({...value,baseUrl:new URL(".",new URL(documentUrl,window.location.href)).href});}).catch(()=>{});return()=>controller.abort();},[documentUrl]);
  const [notebook,setNotebook] = useState<Notebook | null>(null), [edits,setEdits] = useState<Record<string,string>>({}), [active,setActive] = useState<string|null>(null), [error,setError] = useState(""), [busy,setBusy] = useState(""), [job,setJob] = useState<Job|null>(null), [notice,setNotice] = useState(""), [undo,setUndo] = useState<{type:string;source:string;after_id?:string}|null>(null);
  const notebookRef=useRef(notebook),editsRef=useRef(edits),saving=useRef<Promise<void>|null>(null);
  const [saveError, setSaveError] = useState("");
  notebookRef.current=notebook; editsRef.current=edits;
  const dirty=Object.keys(edits).length>0;
  const running = !!job && ["queued", "running"].includes(job.state);
  useEffect(()=>onStatusChange({dirty, saving: busy === "saving", busy: !!busy, running, ready: !!notebook, saveError}),[dirty,busy,running,!!notebook,saveError,onStatusChange]);
  useImperativeHandle(ref, () => ({saveDraft: saveAll, hasUnsavedChanges: () => Object.keys(editsRef.current).length > 0}));
  useEffect(()=>{let alive=true;request<Notebook>(`/api/report-workspaces/${workspaceId}/notebook`).then(value=>{if(alive){setNotebook(value);notebookRef.current=value;const starter=value.cells.find(cell=>cell.type==="markdown" && cell.source.trim()===EMPTY_REPORT_CELL);if(starter)setActive(starter.id);}}).catch(error=>{if(alive)setError(String(error));});return()=>{alive=false;};},[workspaceId]);
  function editCell(cell: Cell, value: string) {
    setSaveError("");
    const next = { ...editsRef.current };
    if (value === cell.source) delete next[cell.id];
    else next[cell.id] = value;
    editsRef.current = next;
    setEdits(next);
  }
  function saveAll(): Promise<void> {
    if (saving.current) return saving.current;
    if (!Object.keys(editsRef.current).length) return Promise.resolve();
    const task = (async () => {
      if (!notebookRef.current) return;
      setError("");
      setSaveError("");
      setBusy("saving");
      try {
        while (Object.keys(editsRef.current).length) {
          const [id, value] = Object.entries(editsRef.current)[0];
          const cell: Cell | undefined = notebookRef.current?.cells.find(
            (c) => c.id === id,
          );
          if (!cell)
            throw new Error(
              "The document changed. Reload the draft before saving this cell.",
            );
          const next: Notebook = await request<Notebook>(
            `/api/report-workspaces/${workspaceId}/cells/${encodeURIComponent(id)}`,
            {
              method: "PUT",
              body: JSON.stringify({ source: value, expected_hash: cell.hash }),
            },
          );
          notebookRef.current = next;
          setNotebook(next);
          if (editsRef.current[id] === value) {
            const copy = { ...editsRef.current };
            delete copy[id];
            editsRef.current = copy;
            setEdits(copy);
          }
        }
        await onSaved();
      } catch (value) {
        setSaveError(String(value));
        throw value;
      } finally {
        setBusy("");
        saving.current = null;
      }
    })();
    saving.current = task;
    return task;
  }
  useEffect(() => {
    if (
      !dirty ||
      busy ||
      publishing ||
      saveError ||
      (job && ["queued", "running"].includes(job.state))
    )
      return;
    const timer = setTimeout(
      () => saveAll().catch((e) => setError(e.message)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [edits, busy, publishing, saveError, job?.state, workspaceId]);
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.state)) return;
    let alive = true;
    const poll = async () => {
      try {
        const result = await request<Job>(`/api/notebook-jobs/${job.id}`);
        if (!alive) return;
        setJob(result);
        if (result.cells)
          setNotebook((n) =>
            n
              ? {
                  ...n,
                  cells: n.cells.map(
                    (c) => result.cells!.find((r) => r.id === c.id) || c,
                  ),
                }
              : n,
          );
        if (result.state === "failed")
          setError(result.error || "Cell execution failed.");
        if (result.state === "finished")
          setNotice(
            result.cache_hit
              ? "Reused matching cached outputs"
              : "Execution complete",
          );
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void poll();
    const timer = setInterval(poll, 600);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [job?.id, job?.state]);
  async function run(cell: Cell, force = false) {
    if (publishing) return;
    try {
      await saveAll();
      setError("");
      const result = await request<Job>(
        `/api/report-workspaces/${workspaceId}/cells/${encodeURIComponent(cell.id)}/run`,
        { method: "POST", body: JSON.stringify({ force }) },
      );
      setJob(result);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function insert(
    type: string,
    after_id?: string,
    restore?: { type: string; source: string; after_id?: string },
  ) {
    try {
      await saveAll();
      setBusy("structure");
      const next = await request<Notebook>(
        `/api/report-workspaces/${workspaceId}/notebook/cells`,
        {
          method: "POST",
          body: JSON.stringify({
            ...restore,
            type: restore?.type || type,
            source:
              restore?.source ||
              (type === "code" ? "# New code cell" : "New section"),
            after_id: restore?.after_id || after_id,
            expected_hash:
              notebookRef.current?.cells.find(cell => cell.id === (restore?.after_id || after_id))?.hash || notebookRef.current?.hash,
          }),
        },
      );
      setNotebook(next);
      notebookRef.current = next;
      await onSaved();
      setEdits({});
      editsRef.current = {};
      if (restore) setUndo(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function remove(cell: Cell) {
    try {
      await saveAll();
      setBusy("structure");
      const current = notebookRef.current!.cells.find((c) => c.id === cell.id)!;
      const index = notebookRef.current!.cells.findIndex(
        (c) => c.id === cell.id,
      );
      const before = notebookRef.current!.cells[index - 1]?.id;
      const next = await request<Notebook>(
        `/api/report-workspaces/${workspaceId}/cells/${encodeURIComponent(cell.id)}?expected_hash=${encodeURIComponent(current.hash)}`,
        { method: "DELETE" },
      );
      setUndo({ type: cell.type, source: current.source, after_id: before });
      setNotebook(next);
      notebookRef.current = next;
      await onSaved();
      setEdits({});
      editsRef.current = {};
      setActive(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  if (!notebook)
    return error ? <Callout error>{error}</Callout> : <Loading />;
  const lastCode = [...notebook.cells].reverse().find((c) => c.type === "code");
  return (
    <DocumentContext.Provider value={definition}>
      <div className="report-notebook">
        <div className="notebook-toolbar">
          <div>
            {notice && <span role="status" className="text-xs text-fg-muted">{notice}</span>}
            <span className="notebook-key-hint">
              Shift ↵ runs the active cell
            </span>
          </div>
          <div className="toolbar">
            {undo && (
              <button onClick={() => insert(undo.type, undo.after_id, undo)}>
                Undo delete
              </button>
            )}
            <button
              disabled={!lastCode || !!running || !!busy || publishing}
              onClick={() => lastCode && run(lastCode)}
            >
              <Play size={13} />
              Run all
            </button>
          </div>
        </div>
        {error && (
          <Callout error>{error} Your edits remain in this draft.</Callout>
        )}
        <div className="notebook-layout">
          <main className="notebook-cells">
            {notebook.cells.map((cell) => (
              <section
                key={cell.id}
                className={`notebook-cell ${active === cell.id ? "active" : ""}`}
                data-cell-id={cell.id}
                onFocusCapture={(event) => {
                  if (!(event.target as HTMLElement).closest("button")) setActive(cell.id);
                }}
              >
                <header>
                  <div>
                    <span>
                      {cell.type === "code" ? (
                        <Code2 size={13} />
                      ) : (
                        <FileText size={13} />
                      )}
                    </span>
                    <span>
                      {cell.type === "code"
                        ? `Python [${cell.execution_count ?? " "}]`
                        : cell.type === "card"
                          ? "Card"
                          : cell.type === "metadata"
                            ? "Document settings"
                            : "Markdown"}
                    </span>
                    {cell.status === "stale" ? <small>Outputs out of date</small> : cell.cache_key && <small>Cached</small>}
                    {edits[cell.id] !== undefined && <small>Edited</small>}
                  </div>
                  <div>
                    {cell.type !== "metadata" && (
                      <button
                        disabled={!!busy || !!running || publishing}
                        onClick={() => remove(cell)}
                        title="Delete cell"
                      >
                        Delete
                      </button>
                    )}
                    {edits[cell.id] !== undefined && (
                      <button
                        title="Discard unsaved changes"
                        onClick={() =>
                          setEdits((v) => {
                            const next = { ...v };
                            delete next[cell.id];
                            editsRef.current = next; return next;
                          })
                        }
                      >
                        <Undo2 size={13} />
                      </button>
                    )}
                    {cell.type === "code" && (
                      <>
                        <button
                          disabled={!!running || !!busy || publishing}
                          onClick={() => run(cell)}
                          title="Run through this cell (Shift+Enter)"
                        >
                          <Play size={14} />
                          {running ? "Running…" : "Run"}
                        </button>
                        <button
                          disabled={!!running || !!busy || publishing}
                          onClick={() => run(cell, true)}
                          title="Execute again without using cached outputs"
                        >
                          Rerun
                        </button>
                      </>
                    )}
                    {active === cell.id && cell.type !== "code" && (
                      <button onClick={() => setActive(null)}>Done</button>
                    )}
                  </div>
                </header>
                {cell.type === "metadata" ? (
                  <details className="notebook-metadata">
                    <summary>Title, inputs and execution environment</summary>
                    <CodeEditor minHeight="90px" readOnly={!!busy || !!running || publishing}
                      language="yaml"
                      value={edits[cell.id] ?? (cell.source.trim() === EMPTY_REPORT_CELL ? "" : cell.source)}
                      onChange={(value) => editCell(cell, value)}
                    onSave={() => void saveAll().catch(error => setError(String(error)))}
                    />
                  </details>
                ) : cell.type === "code" || active === cell.id ? (
                  <CodeEditor minHeight="90px" readOnly={!!busy || !!running || publishing}
                    key={cell.id}
                    language={
                      cell.type === "code"
                        ? "python"
                        : cell.type === "card"
                          ? "yaml"
                          : "markdown"
                    }
                    value={edits[cell.id] ?? (cell.source.trim() === EMPTY_REPORT_CELL ? "" : cell.source)}
                    onChange={(value) => editCell(cell, value)}
                    onSave={() => void saveAll().catch(error => setError(String(error)))}
                    onRun={() =>
                      cell.type === "code" ? run(cell) : setActive(null)
                    }
                    focus={active === cell.id}
                  />
                ) : (
                  <div
                    className="notebook-prose native-document"
                    tabIndex={0}
                    role="button"
                    aria-label={`Write Markdown cell ${cell.index + 1}`}
                    onClick={() => setActive(cell.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setActive(cell.id);
                    }}
                  >
                    <Markdown text={edits[cell.id] ?? cell.source} />
                  </div>
                )}
                {!!cell.outputs?.length && (
                  <div className={`notebook-output native-document ${cell.status === "stale" ? "opacity-60" : ""}`}>
                    {cell.outputs.map((output, i) => (
                      <OutputView key={i} output={output} />
                    ))}
                  </div>
                )}
                <div className="notebook-insert">
                  <button
                    disabled={!!busy || !!running || publishing}
                    onClick={() => insert("markdown", cell.id)}
                  >
                    + Markdown
                  </button>
                  <button
                    disabled={!!busy || !!running || publishing}
                    onClick={() => insert("code", cell.id)}
                  >
                    + Code
                  </button>
                </div>
              </section>
            ))}
            {!notebook.cells.length && (
              <div className="notebook-empty">
                <h3>Start writing</h3>
                <p>Add your first Markdown or Python cell.</p>
                <button onClick={() => insert("markdown")}>Add Markdown</button>
                <button onClick={() => insert("code")}>Add code</button>
              </div>
            )}
          </main>
        </div>
      </div>
    </DocumentContext.Provider>
  );
});
