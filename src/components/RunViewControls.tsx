/**
 * Per-run run-view controls: a colour swatch, and the pin (listed and drawn
 * first) and baseline toggles of the project run view. Which runs the
 * charts draw is the workspace view's eyes (lib/workspace-runs/visibility.ts),
 * not a toggle here. Used by the Runs page and the workspace sidebar.
 */

import type { RunView } from "../lib/run-view";
import { toggleRunBaseline, toggleRunPinned } from "../lib/run-view-store";

export function RunSwatch({ color }: { color: string | undefined }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: color ?? "transparent" }}
    />
  );
}

export type RunViewToggle = "pin" | "baseline";
const ALL_TOGGLES: readonly RunViewToggle[] = ["pin", "baseline"];

const CONTROL_BTN =
  "inline-flex h-5 w-5 items-center justify-center rounded text-[10px] hover:bg-bg-hover touch:h-9 touch:w-9";

/** Pin (first in charts and the table) and baseline toggles for one run. */
export default function RunViewControls({
  runId,
  view,
  onChange,
  show = "hover",
  toggles = ALL_TOGGLES,
}: {
  runId: string;
  view: RunView;
  onChange?: (next: RunView) => void;
  /** "hover": inactive toggles appear on row/chip hover; "all": always; "active": only the set ones. */
  show?: "hover" | "all" | "active";
  /** Which toggles (default both). */
  toggles?: readonly RunViewToggle[];
}) {
  const pinned = toggles.includes("pin") && view.pinned.includes(runId);
  const baseline = toggles.includes("baseline") && view.baseline === runId;
  const idle =
    show === "all"
      ? "text-fg-subtle hover:text-fg"
      : "text-fg-subtle can-hover:opacity-0 can-hover:group-hover/row:opacity-100 can-hover:group-hover/chip:opacity-100 focus-visible:opacity-100";
  if (!onChange) return null;
  if (show === "active" && !pinned && !baseline) return null;
  return (
    <span className="run-controls inline-flex items-center">
      {toggles.includes("pin") && (show !== "active" || pinned) && <button
        type="button"
        className={`${CONTROL_BTN} ${pinned ? "text-accent" : idle}`}
        onClick={() => onChange(toggleRunPinned(view, runId))}
        aria-pressed={pinned}
        title={pinned ? "Unpin" : "Pin: listed and drawn first"}
        aria-label={pinned ? "Unpin run" : "Pin run"}
      >
        <i className="fa-solid fa-thumbtack" aria-hidden="true" />
      </button>}
      {toggles.includes("baseline") && (show !== "active" || baseline) && <button
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
