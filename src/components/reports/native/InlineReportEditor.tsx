import { useEffect, useState } from "react";
import { CodeEditor } from "./CodeEditor";
import { BuildDiagnostics } from "./BuildDiagnostics";
import { workspaceApi, type ReportWorkspace, type ReportBuild } from "./workspace-api";

type SourceRange = {revision:number;file:string;line:number;end_line:number;text:string;type:string};
async function request<T>(path:string, body?:unknown):Promise<T> {
  const response=await fetch(path,{method:body===undefined?"GET":"PUT",headers:body===undefined?undefined:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  const value=await response.json();
  if(!response.ok)throw new Error(typeof value.detail==="string"?value.detail:`Request failed (${response.status})`);
  return value as T;
}

/** One precise source edit builds a new immutable version of the same report. */
export function InlineReportEditor({reportId,versionId,blockId,onClose}:{reportId:string;versionId:string;blockId:string;onClose:()=>void}) {
  const [workspace,setWorkspace]=useState<ReportWorkspace|null>(null);
  const [source,setSource]=useState<SourceRange|null>(null);
  const [text,setText]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(true);
  const [saved,setSaved]=useState(false);
  const [job,setJob]=useState<ReportBuild|null>(null);
  const running=!!job&&["queued","running","pending"].includes(job.status);
  const dirty=!!source&&!saved&&text!==source.text;
  useEffect(()=>{
    let stopped=false;
    async function open(){try{
      const draft=await workspaceApi.copy(reportId,versionId);
      const range=await request<SourceRange>(`/api/report-workspaces/${draft.id}/blocks/${encodeURIComponent(blockId)}`);
      if(!stopped){setWorkspace(draft);setSource(range);setText(range.text);}
    }catch(error){if(!stopped)setError(String(error));}finally{if(!stopped)setBusy(false);}}
    void open();return()=>{stopped=true;};
  },[reportId,versionId,blockId]);
  useEffect(()=>{
    if(!dirty)return;
    const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);
  },[dirty]);
  const publish=async()=>{
    if(!workspace||busy||running)return;
    setBusy(true);setError("");
    try{
      const draft=saved?workspace:await request<ReportWorkspace>(`/api/report-workspaces/${workspace.id}/blocks/${encodeURIComponent(blockId)}`,{expected_revision:workspace.revision,replacement:text});
      setWorkspace(draft);setSaved(true);setJob(await workspaceApi.build(draft.id,draft.revision));
    }catch(error){setError(String(error));}finally{setBusy(false);}
  };
  useEffect(()=>{
    if(!running||!job)return;
    let stopped=false;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const next=await workspaceApi.status(job.id);if(stopped)return;setJob(next);if(["queued","running","pending"].includes(next.status))timer=setTimeout(poll,1000);}catch(error){if(!stopped){setError(String(error));timer=setTimeout(poll,3000);}}};
    timer=setTimeout(poll,1000);return()=>{stopped=true;clearTimeout(timer);};
  },[job?.id,running]);
  const close=()=>{if(!dirty||window.confirm("Discard this unsaved block edit?"))onClose();};
  return <div className="inline-report-editor" data-selection-ignore>
    <header><div><strong>Edit this block</strong>{source&&<small>{source.file}:{source.line}–{source.end_line}</small>}</div><button aria-label="Close inline editor" onClick={close}>×</button></header>
    <p>Publish a new version of this report. Existing versions stay available.</p>
    {busy&&!source&&<p role="status">Opening source…</p>}
    {source&&<CodeEditor value={text} onChange={setText} language="markdown" readOnly={busy||running||saved} focus minHeight="110px" label={`Edit ${source.file}:${source.line}`} onRun={()=>void publish()} onSave={()=>void publish()}/>}
    {error&&<p role="alert">{error}</p>}
    {job&&<p role="status">Build: {job.status}{job.error&&` — ${job.error}`}{job.result?.url&&<> · <a href={job.result.url}>Open new version →</a></>}</p>}
    {job?.status==="failed"&&<BuildDiagnostics buildId={job.id}/>}
    <footer><button onClick={close}>Cancel</button><button className="btn btn-primary" disabled={!source||busy||running||job?.status==="completed"||(!dirty&&!saved)} onClick={()=>void publish()}>{running?"Building new version…":busy?"Saving…":saved?"Retry build":"Publish new version"}</button></footer>
    {workspace&&saved&&<a className="inline-editor-source-link" href={`?tab=edit&workspace=${workspace.id}`}>Continue in full source editor</a>}
  </div>;
}
