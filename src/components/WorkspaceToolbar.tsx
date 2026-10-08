/**
 * The toolbar of a workspace (the run page and every comparison render the
 * same one): the view switcher (components/workspace/ViewSwitcher.tsx),
 * search (⌘K, a regex over panel labels), "hide matching" (a
 * sticky hide pattern), "Manage cards", "include unlisted metrics", the
 * sync-zoom toggle and colour-by (with its legend). Cards and
 * sections are added from the + buttons of the layout itself
 * (components/workspace/WorkspaceView.tsx), not here. Everything
 * but search edits the enclosing workspace (`WorkspaceRefContext`), so a
 * read-only surface shows only the search box.
 */

import { useContext, useMemo, useRef, useState } from "react";
import { CardMutationContext } from "../lib/card-settings";
import { formatShortcut } from "../lib/shortcuts";
import { IS_MAC, useShortcut } from "../lib/use-shortcut";
import { COLOR_BY_BUCKETS, ops, type ColorBy, type ColorByPalette } from "../lib/workspace/doc";
import type { MetricInfo } from "../lib/workspace/layout";
import { useRunColorBy, type RunColorByValue } from "../lib/run-color-by-context";
import { useScalarExprs } from "../lib/use-scalar-exprs";
import { Select, Stepper } from "./settings/palette";
import ExprField from "./settings-panels/ExprField";
import { compilePanelFilter } from "../lib/workspace/panel-filter";
import { useCurrentWorkspace } from "../lib/workspace/use-workspace";
import { HeaderToggle } from "./card-header";
import Popover from "./ui/Popover";
import ViewSwitcher from "./workspace/ViewSwitcher";

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  /** How many cards the query matches (shown on the "hide matching" chip). */
  matchCount?: number;
  /** Open "Manage cards". */
  onManageCards?: () => void;
  /** Flip "include unlisted metrics" (turning it off writes the automatic cards shown now). */
  onToggleAutoPanels?: () => void;
  /** The bound runs' metrics: the view switcher's tiles resolve each view's layout against them. */
  metrics: readonly MetricInfo[];
}

const CHIP =
  "inline-flex items-center gap-1 rounded-full border border-border bg-bg-elevated px-2 py-0.5 text-xs text-fg-muted touch:min-h-10";
const TOOL_BTN =
  "inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-accent hover:text-fg touch:min-h-10";

export default function WorkspaceToolbar({
  query,
  onQueryChange,
  matchCount,
  onManageCards,
  onToggleAutoPanels,
  metrics,
}: Props) {
  const { doc, readOnly, update } = useCurrentWorkspace();
  const mutable = useContext(CardMutationContext) && !readOnly;
  const searchRef = useRef<HTMLInputElement>(null);
  const filter = useMemo(() => compilePanelFilter(query), [query]);

  useShortcut(
    "mod+k",
    () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    },
    { allowInInputs: true },
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {mutable && <ViewSwitcher metrics={metrics} />}
      <div className="relative min-w-[12rem] flex-1 sm:max-w-sm">
        <i
          className="fa-solid fa-magnifying-glass pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-fg-subtle"
          aria-hidden="true"
        />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.preventDefault();
              e.stopPropagation();
              onQueryChange("");
            }
          }}
          placeholder={`Search panels (regex)  ${formatShortcut("mod+k", IS_MAC)}`}
          aria-label="Search panels"
          aria-invalid={!!filter.error}
          title={filter.error ? `Not a regex (${filter.error}); matching as text` : undefined}
          className={`input w-full py-1 pl-7 text-sm ${filter.error ? "!border-status-failed" : ""}`}
        />
      </div>

      {mutable && filter.query && (
        <button
          type="button"
          className={`${CHIP} hover:border-accent hover:text-fg`}
          onClick={() => {
            update(ops.addHidePattern(filter.query), { label: `Hide /${filter.query}/` });
            onQueryChange("");
          }}
          title="Hide every panel matching the search, for every run of this workspace"
        >
          <i className="fa-solid fa-eye-slash" aria-hidden="true" />
          Hide {matchCount ?? ""} matching
        </button>
      )}

      {doc.hidePatterns.map((p) => (
        <span key={p} className={CHIP} title="Cards matching this pattern are hidden">
          <i className="fa-solid fa-eye-slash text-[10px]" aria-hidden="true" />
          <span className="mono">/{p}/</span>
          {mutable && (
            <button
              type="button"
              className="ml-0.5 text-fg-subtle hover:text-fg"
              onClick={() => update(ops.removeHidePattern(p), { label: `Show /${p}/` })}
              aria-label={`Stop hiding /${p}/`}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          )}
        </span>
      ))}

      <ColorByLegend />

      {mutable && (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {onManageCards && (
            <button
              type="button"
              className={TOOL_BTN}
              onClick={onManageCards}
              title="Every card of this workspace: show, hide, edit, duplicate, delete; drag to arrange cards and sections"
              data-testid="manage-cards-open"
            >
              <i className="fa-solid fa-table-list" aria-hidden="true" /> Manage cards
            </button>
          )}
          <ColorByControl />
          {onToggleAutoPanels && (
            <button
              type="button"
              className={`${TOOL_BTN} ${doc.autoPanels ? "" : "!border-accent !text-fg"}`}
              onClick={onToggleAutoPanels}
              aria-pressed={doc.autoPanels}
              data-testid="toggle-auto-panels"
              title={
                doc.autoPanels
                  ? "Unlisted metrics get automatic cards. Click to show only listed cards (the cards shown now are kept)."
                  : "Only listed cards are shown; new metrics wait in Manage cards. Click to include unlisted metrics again."
              }
            >
              <i className={`fa-solid ${doc.autoPanels ? "fa-layer-group" : "fa-thumbtack"}`} aria-hidden="true" />
              {doc.autoPanels ? "Unlisted metrics: on" : "Unlisted metrics: off"}
            </button>
          )}
          <HeaderToggle
            icon="fa-link"
            label={doc.prefs.syncZoom ? "Zoom synced across charts (click to unlink)" : "Sync zoom across charts"}
            pressed={doc.prefs.syncZoom}
            onToggle={() =>
              update(ops.setPrefs({ syncZoom: !doc.prefs.syncZoom }), {
                label: doc.prefs.syncZoom ? "Unsync zoom" : "Sync zoom",
              })
            }
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Colour by (lib/run-color-by.ts)
// ---------------------------------------------------------------------------

const COLOR_BY_PALETTE_OPTIONS: Array<{ value: ColorByPalette; label: string }> = [
  { value: "turbo", label: "Turbo" },
  { value: "viridis", label: "Viridis" },
  { value: "magma", label: "Magma" },
];

/** The active colour-by's key: its expression and each bucket's swatch. */
function ColorByLegend() {
  const cb = useRunColorBy();
  if (!cb?.colorBy) return null;
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg-muted"
      aria-label={`Runs coloured by ${cb.colorBy.expr}`}
      data-testid="color-by-legend"
    >
      <span className="mono text-fg" title="Runs coloured by">
        <i className="fa-solid fa-palette mr-1 text-fg-subtle" aria-hidden="true" />
        {cb.colorBy.expr}
      </span>
      {cb.error ? (
        <span className="text-status-failed">{cb.error}</span>
      ) : cb.loading ? (
        <span>…</span>
      ) : (
        cb.legend.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
            <span className="mono">{l.label}</span>
          </span>
        ))
      )}
    </div>
  );
}

function ColorByControl() {
  const cb = useRunColorBy();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { doc, update } = useCurrentWorkspace();
  if (!cb) return null;
  const current = doc.prefs.colorBy;
  const set = (next: ColorBy | null, label: string) => update(ops.setPrefs({ colorBy: next }), { label });
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`${TOOL_BTN} ${current ? "!border-accent !text-fg" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="Colour runs by a value"
        aria-pressed={current != null}
      >
        <i className="fa-solid fa-palette" aria-hidden="true" /> Colour by
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        title="Colour runs by"
        titleAnchored
        width={320}
        align="end"
        bodyClassName="flex flex-col gap-3 p-4"
      >
        {open && <ColorByForm cb={cb} current={current} set={set} />}
      </Popover>
    </>
  );
}

function ColorByForm({
  cb,
  current,
  set,
}: {
  cb: RunColorByValue;
  current: ColorBy | null;
  set: (next: ColorBy | null, label: string) => void;
}) {
  const runIds = useMemo(() => [...cb.runIds], [cb.runIds]);
  const { options } = useScalarExprs(runIds, []);
  const base: ColorBy = current ?? { expr: "", buckets: 4, palette: "turbo" };
  return (
    <>
      <ExprField
        label="Value"
        info="Each run's value of this expression picks its colour: numbers go into evenly spaced buckets between the lowest and highest run, text gets one colour per value."
        value={current?.expr ?? null}
        onChange={(expr) => (expr == null ? set(null, "Colour by run") : set({ ...base, expr }, `Colour by ${expr}`))}
        options={options}
        placeholder="config.lr, min(val.loss), run.group"
        clearable
      />
      <Stepper
        label="Buckets"
        value={base.buckets}
        min={COLOR_BY_BUCKETS.min}
        max={COLOR_BY_BUCKETS.max}
        disabled={!current}
        onChange={(buckets) => current && set({ ...current, buckets }, `Colour buckets ${buckets}`)}
      />
      <Select
        label="Palette"
        value={base.palette}
        options={COLOR_BY_PALETTE_OPTIONS}
        disabled={!current}
        onChange={(palette) => current && set({ ...current, palette }, `Colour palette ${palette}`)}
      />
      <div className="flex justify-end">
        <button
          type="button"
          className="btn text-xs disabled:opacity-50"
          disabled={!current}
          onClick={() => set(null, "Colour by run")}
        >
          Clear
        </button>
      </div>
    </>
  );
}
