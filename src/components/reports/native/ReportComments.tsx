import { useEffect, useState } from "react";
import type { TextSelection } from "./textSelection";
type Comment = {id: string; parent_id: string | null; body: string; author: string; revision: number; resolved_at: string | null; anchor_id: string | null; selection: TextSelection | null; created_at: string};
export function ReportComments({projectId, reportId, versionId, blockId, selection, onLocate, onClose}: {projectId: string; reportId: string; versionId: string; blockId: string; selection?: TextSelection; onLocate: (selection: TextSelection) => void; onClose: () => void}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState("");
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/projects/${encodeURIComponent(projectId)}/reports/${encodeURIComponent(reportId)}/comments`;
  const request = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(path, {method, headers: body ? {"Content-Type": "application/json"} : undefined, body: body ? JSON.stringify(body) : undefined});
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Request failed (${response.status})`);
    return data;
  };
  const load = async () => {const data = await request(`${base}?revision_id=${encodeURIComponent(versionId)}`); setComments(data.comments);};
  useEffect(() => {let stopped = false; setError(""); request(`${base}?revision_id=${encodeURIComponent(versionId)}`).then(data => {if (!stopped) setComments(data.comments);}).catch(error => {if (!stopped) setError(String(error));}); return () => {stopped = true;};}, [base, versionId]);
  const mutate = async (operation: () => Promise<unknown>) => {setBusy(true); setError(""); try {await operation(); await load();} catch(error) {setError(String(error));} finally {setBusy(false);}};
  return <aside className="report-comments" data-selection-ignore aria-label="Report comments"><header><h4>{selection ? "Passage comments" : "Section comments"}</h4><button onClick={onClose} aria-label="Close comments">×</button></header><p className="comment-context">Saved with publication {versionId.slice(0, 8)}</p>{selection && <blockquote>{selection.exact}</blockquote>}{error && <p role="alert">{error}</p>}
    {comments.filter(comment => !comment.parent_id && comment.anchor_id === blockId).map(comment => <div key={comment.id} className={`comment-thread ${comment.resolved_at ? "resolved" : ""}`}><div className="comment-byline"><strong>{comment.author}</strong><time>{new Date(comment.created_at).toLocaleString()}</time>{comment.resolved_at && <span>Resolved</span>}</div>{comment.selection && <blockquote className="comment-quote">{comment.selection.exact}<button onClick={() => onLocate(comment.selection!)}>Locate passage</button></blockquote>}{editing === comment.id ? <><textarea aria-label="Edit comment" value={draft} onChange={event => setDraft(event.target.value)} /><button disabled={busy || !draft.trim()} onClick={() => void mutate(async () => {await request(`${base}/${comment.id}`, "PUT", {body: draft, expected_revision: comment.revision}); setEditing(null);})}>Save edit</button><button onClick={() => setEditing(null)}>Cancel</button></> : <p className="comment-body">{comment.body}</p>}<div className="comment-actions"><button disabled={busy} onClick={() => void mutate(() => request(`${base}/${comment.id}/resolve`, "POST", {resolved: !comment.resolved_at, expected_revision: comment.revision}))}>{comment.resolved_at ? "Reopen" : "Resolve"}</button><button onClick={() => {setEditing(comment.id); setDraft(comment.body);}}>Edit</button></div>{comments.filter(reply => reply.parent_id === comment.id).map(reply => <div className="comment-reply" key={reply.id}><strong>{reply.author}</strong><p>{reply.body}</p></div>)}<form className="comment-reply-form" onSubmit={event => {event.preventDefault(); void mutate(async () => {await request(base, "POST", {body: replies[comment.id], parent_id: comment.id, revision_id: versionId}); setReplies(previous => ({...previous, [comment.id]: ""}));});}}><input aria-label={`Reply to ${comment.author}`} value={replies[comment.id] || ""} onChange={event => setReplies(previous => ({...previous, [comment.id]: event.target.value}))} placeholder="Reply…" /><button disabled={busy || !replies[comment.id]?.trim()}>Reply</button></form></div>)}
    <form className="comment-compose" onSubmit={event => {event.preventDefault(); void mutate(async () => {await request(base, "POST", {body, revision_id: versionId, anchor_kind: selection ? "quote" : "block", anchor_id: blockId, quote: selection?.exact, selection}); setBody("");});}}><label>Comment<textarea value={body} onChange={event => setBody(event.target.value)} placeholder="Add a comment…" maxLength={16384} /></label><button disabled={busy || !body.trim()}>Add comment</button></form>
  </aside>;
}
