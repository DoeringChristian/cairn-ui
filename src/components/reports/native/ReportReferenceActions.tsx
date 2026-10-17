import { Check, Copy, MessageSquare, Pencil } from "lucide-react";

/** The same compact reference actions for a selection, heading, or output block. */
export function ReportReferenceActions({copied = false, canCopy = true, onCopy, onComment, commentDisabled, onEdit}: {
  copied?: boolean;
  canCopy?: boolean;
  onCopy: () => void;
  onComment: () => void;
  commentDisabled?: string;
  onEdit?: () => void;
}) {
  const copyLabel = copied ? "Reference copied" : "Copy source reference";
  return <>
    <button type="button" className="report-reference-action" aria-label={copyLabel} title={canCopy ? copyLabel : "Source location is unavailable for this publication"} disabled={!canCopy} onClick={onCopy}>
      {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
    </button>
    <button type="button" className="report-reference-action" aria-label="Comment" title={commentDisabled || "Comment"} disabled={!!commentDisabled} onClick={onComment}>
      <MessageSquare size={15} aria-hidden="true" />
    </button>
    {onEdit && <button type="button" className="report-reference-action" aria-label="Edit block" title="Edit block" onClick={onEdit}><Pencil size={15} aria-hidden="true" /></button>}
  </>;
}
