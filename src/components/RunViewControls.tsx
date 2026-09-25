/**
 * Per-run run-view controls: a colour swatch, and the eye (hide from
 * charts), pin (listed and drawn first) and baseline toggles. Used by the
 * runs table and `RunSetEditor`; the toggles edit whichever run view the
 * caller passes (project, comparison or report cell).
 */

import type { RunView } from "../lib/run-view";
import { toggleRunBaseline, toggleRunHidden, toggleRunPinned } from "../lib/run-view-store";

export function RunSwatch({ color }: { color: string | undefined }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: color ?? "transparent" }}
    />
  );
}

const CONTROL_BTN =
  "inline-flex h-5 w-5 items-center justify-center rounded text-[10px] hover:bg-bg-hover touch:h-9 touch:w-9";

/** Eye (hide from charts), pin (first in charts and the table) and baseline toggles for one run. */
export default function RunViewControls({
  runId,
  view,
  onChange,
  show = "hover",
}: {
  runId: string;
  view: RunView;
  onChange?: (next: RunView) => void;
  /** "hover": inactive toggles appear on row/chip hover; "all": always; "active": only the set ones. */
  show?: "hover" | "all" | "active";
}) {
  const hidden = view.hidden.includes(runId);
  const pinned = view.pinned.includes(runId);
  const baseline = view.baseline === runId;
  const idle =
    show === "all"
      ? "text-fg-subtle hover:text-fg"
      : "text-fg-subtle can-hover:opacity-0 can-hover:group-hover/row:opacity-100 can-hover:group-hover/chip:opacity-100 focus-visible:opacity-100";
  if (!onChange) return null;
  if (show === "active" && !hidden && !pinned && !baseline) return null;
  return (
    <span className="run-controls inline-flex items-center">
      {(show !== "active" || hidden) && <button
        type="button"
        className={`${CONTROL_BTN} ${hidden ? "text-status-failed" : idle}`}
        onClick={() => onChange(toggleRunHidden(view, runId))}
        aria-pressed={hidden}
        title={hidden ? "Hidden from charts: show" : "Hide from charts"}
        aria-label={hidden ? "Show run in charts" : "Hide run from charts"}
      >
        <i className={`fa-solid ${hidden ? "fa-eye-slash" : "fa-eye"}`} aria-hidden="true" />
      </button>}
      {(show !== "active" || pinned) && <button
        type="button"
        className={`${CONTROL_BTN} ${pinned ? "text-accent" : idle}`}
        onClick={() => onChange(toggleRunPinned(view, runId))}
        aria-pressed={pinned}
        title={pinned ? "Unpin" : "Pin: listed and drawn first"}
        aria-label={pinned ? "Unpin run" : "Pin run"}
      >
        <i className="fa-solid fa-thumbtack" aria-hidden="true" />
      </button>}
      {(show !== "active" || baseline) && <button
        type="button"
        className={`${CONTROL_BTN} ${baseline ? "text-accent" : idle}`}
        onClick={() => onChange(toggleRunBaseline(view, runId))}
        aria-pressed={baseline}
        title={baseline ? "Clear baseline" : "Set as baseline: other runs show deltas against it"}
        aria-label={baseline ? "Clear baseline" : "Set as baseline"}
      >
        <i className="fa-solid fa-flag" aria-hidden="true" />
      </button>}
    </span>
  );
}
