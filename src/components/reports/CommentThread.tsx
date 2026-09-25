/**
 * Report comment threads: one thread (`CommentThread`: the first comment,
 * its replies, a reply box, resolve/reopen), a composer, and the popover a
 * card, cell or text selection opens (`CommentsPopover`: that place's
 * threads plus a box for a new one).
 *
 * Edit and delete show only on comments the server marks `can_edit` (the
 * author or an admin). Deleting a thread's first comment deletes the thread.
 * Only rendered in an editable report (see comments-context.ts).
 */

import { useState, type RefObject } from "react";
import type { ReportComment } from "../../api/types";
import { useReportCommentMutations } from "../../api/hooks";
import { formatRelative } from "../../lib/format";
import type { CommentAnchor } from "../../lib/reports/comment-anchors";
import Popover from "../ui/Popover";
import type { CommentThreadData } from "./comments-context";

const LINK_BTN = "text-[11px] text-fg-subtle hover:text-fg disabled:opacity-40 touch:min-h-8";

export function CommentComposer({
  onSubmit,
  placeholder = "Add a comment…",
  submitLabel = "Comment",
  initial = "",
  autoFocus = false,
  onCancel,
}: {
  onSubmit: (body: string) => Promise<unknown>;
  placeholder?: string;
  submitLabel?: string;
  initial?: string;
  autoFocus?: boolean;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text);
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        placeholder={placeholder}
        rows={2}
        autoFocus={autoFocus}
        className="input w-full resize-y text-xs leading-relaxed"
        aria-label={placeholder}
      />
      {error && <p className="text-[11px] text-status-failed">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button type="button" className={LINK_BTN} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className="btn text-xs touch:min-h-10" disabled={!text.trim() || busy} onClick={() => void submit()}>
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
    </div>
  );
}

function CommentItem({ c, projectId, reportId }: { c: ReportComment; projectId: string; reportId: string }) {
  const m = useReportCommentMutations(projectId, reportId);
  const [editing, setEditing] = useState(false);
  const isRoot = c.parent_id == null;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2 text-[11px]">
        <span className="font-semibold text-fg">{c.author}</span>
        <span className="text-fg-subtle" title={c.created_at}>
          {formatRelative(c.created_at)}
          {c.updated_at !== c.created_at ? " · edited" : ""}
        </span>
        {c.can_edit && !editing && (
          <span className="ml-auto flex gap-2">
            <button type="button" className={LINK_BTN} onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              type="button"
              className={`${LINK_BTN} hover:text-status-failed`}
              disabled={m.remove.isPending}
              onClick={() => {
                if (!isRoot || window.confirm("Delete this thread and all its replies?")) m.remove.mutate(c.id);
              }}
            >
              Delete
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <CommentComposer
          initial={c.body}
          submitLabel="Save"
          autoFocus
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            await m.update.mutateAsync({ id: c.id, body });
            setEditing(false);
          }}
        />
      ) : (
        <p className="whitespace-pre-wrap break-words text-xs text-fg">{c.body}</p>
      )}
    </div>
  );
}

/** One thread: the first comment (with its quote), replies, a reply box and resolve/reopen. */
export function CommentThread({
  thread,
  projectId,
  reportId,
  label,
  onLocate,
}: {
  thread: CommentThreadData;
  projectId: string;
  reportId: string;
  /** Where the thread sits, shown above it (the report-level panel). */
  label?: string;
  /** Scroll to the thread's place (the report-level panel). */
  onLocate?: () => void;
}) {
  const m = useReportCommentMutations(projectId, reportId);
  const { root, replies } = thread;
  const resolved = root.resolved_at != null;
  const [replying, setReplying] = useState(false);
  return (
    <div className={`flex flex-col gap-2 rounded border border-border-subtle p-2 ${resolved ? "opacity-70" : ""}`} data-comment-thread={root.id}>
      {(label || resolved) && (
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-fg-subtle">
          {label &&
            (onLocate ? (
              <button type="button" className="truncate hover:text-fg" onClick={onLocate} title="Show in the report">
                {label}
              </button>
            ) : (
              <span className="truncate">{label}</span>
            ))}
          {resolved && (
            <span className="ml-auto shrink-0 normal-case tracking-normal text-status-completed">
              <i className="fa-solid fa-check mr-1" aria-hidden="true" />
              Resolved{root.resolved_by ? ` by ${root.resolved_by}` : ""}
            </span>
          )}
        </div>
      )}
      {root.anchor_kind === "quote" && root.quote && (
        <blockquote className="border-l-2 border-accent/60 pl-2 text-[11px] italic text-fg-muted line-clamp-3">{root.quote}</blockquote>
      )}
      <CommentItem c={root} projectId={projectId} reportId={reportId} />
      {replies.map((r) => (
        <div key={r.id} className="ml-3 border-l border-border-subtle pl-2">
          <CommentItem c={r} projectId={projectId} reportId={reportId} />
        </div>
      ))}
      {replying ? (
        <CommentComposer
          placeholder="Reply…"
          submitLabel="Reply"
          autoFocus
          onCancel={() => setReplying(false)}
          onSubmit={async (body) => {
            await m.create.mutateAsync({ body, parent_id: root.id });
            setReplying(false);
          }}
        />
      ) : (
        <div className="flex gap-3">
          <button type="button" className={LINK_BTN} onClick={() => setReplying(true)}>
            Reply
          </button>
          <button
            type="button"
            className={LINK_BTN}
            disabled={m.resolve.isPending}
            onClick={() => m.resolve.mutate({ id: root.id, resolved: !resolved })}
          >
            {resolved ? "Reopen" : "Resolve"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The comments of one place (a card, a cell, a text selection): its threads,
 * open ones first, and a box starting a new thread on `anchor`.
 */
export function CommentsPopover({
  open,
  onClose,
  anchorRef,
  title,
  threads,
  anchor,
  projectId,
  reportId,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  title: string;
  threads: CommentThreadData[];
  /** Where a new thread goes. */
  anchor: CommentAnchor;
  projectId: string;
  reportId: string;
}) {
  const m = useReportCommentMutations(projectId, reportId);
  const [showResolved, setShowResolved] = useState(false);
  const openThreads = threads.filter((t) => t.root.resolved_at == null);
  const resolvedThreads = threads.filter((t) => t.root.resolved_at != null);
  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      title={title}
      titleAnchored
      width={340}
      align="end"
      bodyClassName="flex flex-col gap-2 p-3"
    >
      {openThreads.map((t) => (
        <CommentThread key={t.root.id} thread={t} projectId={projectId} reportId={reportId} />
      ))}
      {resolvedThreads.length > 0 && (
        <button type="button" className={`${LINK_BTN} self-start`} onClick={() => setShowResolved((v) => !v)}>
          {showResolved ? "Hide" : "Show"} {resolvedThreads.length} resolved
        </button>
      )}
      {showResolved &&
        resolvedThreads.map((t) => <CommentThread key={t.root.id} thread={t} projectId={projectId} reportId={reportId} />)}
      {anchor.anchor_kind === "quote" && anchor.quote && threads.length === 0 && (
        <blockquote className="border-l-2 border-accent/60 pl-2 text-[11px] italic text-fg-muted line-clamp-3">{anchor.quote}</blockquote>
      )}
      <CommentComposer
        autoFocus={threads.length === 0}
        placeholder={threads.length === 0 ? "Add a comment…" : "Start a new thread…"}
        onSubmit={(body) => m.create.mutateAsync({ body, ...anchor })}
      />
    </Popover>
  );
}
