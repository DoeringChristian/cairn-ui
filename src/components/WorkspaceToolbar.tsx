/**
 * The toolbar of a workspace (the run page and every comparison render the
 * same one): search (⌘K, a regex over panel labels), "hide matching" (a
 * sticky hide pattern), "Add cards" and "Manage cards" (the card builder),
 * the quick panel builder, "+ Section", "include unlisted metrics", the
 * sync-zoom toggle, colour-by (with its legend) and saved views. Everything
 * but search edits the enclosing workspace (`WorkspaceRefContext`), so a
 * read-only surface shows only the search box.
 */

import { useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { CardMutationContext } from "../lib/card-settings";
import { formatShortcut } from "../lib/shortcuts";
import { IS_MAC, useShortcut } from "../lib/use-shortcut";
import { COLOR_BY_BUCKETS, normalizeWorkspace, ops, type ColorBy, type ColorByPalette, type WorkspaceDoc } from "../lib/workspace/doc";
import { useRunColorBy, type RunColorByValue } from "../lib/run-color-by-context";
import { useScalarExprs } from "../lib/use-scalar-exprs";
import { Select, Stepper } from "./settings/palette";
import ExprField from "./settings-panels/ExprField";
import { compilePanelFilter } from "../lib/workspace/panel-filter";
import { buildPanels, type BuiltPanel } from "../lib/workspace/panel-builder";
import { useCurrentWorkspace } from "../lib/workspace/use-workspace";
import { parseViewPayload, viewPayload } from "../lib/workspace/views";
import { HeaderToggle } from "./card-header";
import Popover from "./ui/Popover";

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  /** How many cards the query matches (shown on the "hide matching" chip). */
  matchCount?: number;
  /** Scalar metric names the panel builder picks from; omit to hide the builder. */
  builderMetrics?: readonly string[];
  /** Add the builder's panels. */
  onBuildPanels?: (panels: BuiltPanel[]) => void;
  /** Add an empty section with this name. */
  onAddSection?: (name: string) => void;
  /** Open the card builder / its "Manage cards" view. */
  onAddCards?: () => void;
  onManageCards?: () => void;
  /** Flip "include unlisted metrics" (turning it off writes the automatic cards shown now). */
  onToggleAutoPanels?: () => void;
  /** The document a saved view stores, with "include unlisted metrics" on or off. */
  viewDoc?: (autoPanels: boolean) => WorkspaceDoc;
  /** Extra buttons at the start of the action group (e.g. "New comparison"). */
  actions?: ReactNode;
}

const CHIP =
  "inline-flex items-center gap-1 rounded-full border border-border bg-bg-elevated px-2 py-0.5 text-xs text-fg-muted touch:min-h-10";
const TOOL_BTN =
  "inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-accent hover:text-fg touch:min-h-10";

export default function WorkspaceToolbar({
  query,
  onQueryChange,
  matchCount,
  builderMetrics,
  onBuildPanels,
  onAddSection,
  onAddCards,
  onManageCards,
  onToggleAutoPanels,
  viewDoc,
  actions,
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
          {actions}
          {onAddCards && (
            <button type="button" className={TOOL_BTN} onClick={onAddCards} title="Card builder: pick data, card types and settings">
              <i className="fa-solid fa-plus" aria-hidden="true" /> Add cards
            </button>
          )}
          {onManageCards && (
            <button type="button" className={TOOL_BTN} onClick={onManageCards} title="Every card of this workspace: show, hide, edit, duplicate, move, delete">
              <i className="fa-solid fa-table-list" aria-hidden="true" /> Manage cards
            </button>
          )}
          {onAddSection && (
            <button
              type="button"
              className={TOOL_BTN}
              onClick={() => {
                const name = prompt("Section name:");
                if (name && name.trim()) onAddSection(name.trim());
              }}
              title="Add an empty section"
            >
              <i className="fa-solid fa-plus" aria-hidden="true" /> Section
            </button>
          )}
          {builderMetrics && onBuildPanels && (
            <PanelBuilder metrics={builderMetrics} onBuild={onBuildPanels} />
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
          <ViewsMenu viewDoc={viewDoc} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick panel builder
// ---------------------------------------------------------------------------

function PanelBuilder({ metrics, onBuild }: { metrics: readonly string[]; onBuild: (panels: BuiltPanel[]) => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pattern, setPattern] = useState("");
  const result = useMemo(() => (pattern.trim() ? buildPanels(pattern, metrics) : null), [pattern, metrics]);
  const panels = result?.ok ? result.panels : [];

  const add = () => {
    if (panels.length === 0) return;
    onBuild(panels);
    setOpen(false);
    setPattern("");
  };

  return (
    <>
      <button ref={anchor} type="button" className={TOOL_BTN} onClick={() => setOpen((v) => !v)} title="Build line plots from a regex">
        <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" /> Build panels
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        title="Build panels"
        titleAnchored
        width={360}
        align="end"
        initialFocus
        bodyClassName="flex flex-col gap-2 p-4"
      >
        <p className="text-xs text-fg-muted">
          A regex over the full metric name. Metrics whose capture groups agree share a line plot:{" "}
          <code className="mono">(train|val)\.loss</code> makes one per split,{" "}
          <code className="mono">.*\.(loss)</code> one with every loss.
        </p>
        <input
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="val\.(.*)"
          aria-label="Metric regex"
          aria-invalid={result != null && !result.ok}
          className={`input mono w-full py-1 text-sm ${result && !result.ok ? "!border-status-failed" : ""}`}
        />
        {result && !result.ok && <p className="text-xs text-status-failed">{result.error}</p>}
        {result?.ok && (
          <div className="max-h-56 overflow-y-auto rounded border border-border">
            {panels.length === 0 ? (
              <p className="p-2 text-xs text-fg-muted">No metric matches.</p>
            ) : (
              <ul className="divide-y divide-border">
                {panels.map((p) => (
                  <li key={p.title} className="px-2 py-1.5 text-xs">
                    <div className="font-medium text-fg">{p.title}</div>
                    <div className="mono truncate text-fg-muted" title={p.metrics.join(", ")}>
                      {p.metrics.join(", ")}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex justify-end">
          <button type="button" className="btn text-xs disabled:opacity-50" disabled={panels.length === 0} onClick={add}>
            Add {panels.length || ""} panel{panels.length === 1 ? "" : "s"}
          </button>
        </div>
      </Popover>
    </>
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

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------

function ViewsMenu({ viewDoc }: { viewDoc?: (autoPanels: boolean) => WorkspaceDoc }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  // Whether the saved view includes unlisted metrics; follows the workspace until changed.
  const [autoChoice, setAutoChoice] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const { ref, doc, update } = useCurrentWorkspace();
  const projectId = ref?.projectId ?? "";
  const views = useQuery({
    queryKey: qk.views(projectId),
    queryFn: () => api.views(projectId),
    enabled: open,
  });
  // Each view's "include unlisted metrics" (views are few; fetched while the menu is open).
  const payloads = useQueries({
    queries: (open ? (views.data?.views ?? []) : []).map((v) => ({
      queryKey: [...qk.views(projectId), v.id, v.rev],
      queryFn: () => api.view(projectId, v.id),
      staleTime: Infinity,
    })),
  });
  const autoOf = (id: string): boolean | null => {
    const p = payloads.find((q) => q.data?.id === id)?.data?.payload;
    return p ? normalizeWorkspace((p as { layout?: unknown }).layout).autoPanels : null;
  };
  const includeUnlisted = autoChoice ?? doc.autoPanels;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const n = name.trim();
      if (!n) return;
      const snapshot = viewDoc ? viewDoc(includeUnlisted) : doc;
      await api.createView(projectId, n, viewPayload(snapshot) as unknown as Record<string, unknown>);
      setName("");
      setAutoChoice(null);
      await qc.invalidateQueries({ queryKey: qk.views(projectId) });
    });

  const apply = (id: string, viewName: string) =>
    run(async () => {
      const view = await api.view(projectId, id);
      update(ops.replaceLayout(parseViewPayload(view.payload)), { label: `Apply view “${viewName}”` });
      setOpen(false);
    });

  const remove = (id: string, viewName: string) =>
    run(async () => {
      if (!confirm(`Delete view “${viewName}”?`)) return;
      await api.deleteView(projectId, id);
      await qc.invalidateQueries({ queryKey: qk.views(projectId) });
    });

  return (
    <>
      <button ref={anchor} type="button" className={TOOL_BTN} onClick={() => setOpen((v) => !v)} title="Saved views">
        <i className="fa-solid fa-bookmark" aria-hidden="true" /> Views
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        title="Saved views"
        titleAnchored
        width={320}
        align="end"
        bodyClassName="flex flex-col gap-2 p-4"
      >
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this view"
            aria-label="View name"
            className="input min-w-0 flex-1 py-1 text-sm"
          />
          <button type="submit" className="btn text-xs disabled:opacity-50" disabled={busy || !name.trim()}>
            Save
          </button>
        </form>
        {viewDoc && (
          <label className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={includeUnlisted}
              onChange={(e) => setAutoChoice(e.target.checked)}
              data-testid="view-include-unlisted"
            />
            Include unlisted metrics
          </label>
        )}
        <p className="text-[11px] text-fg-subtle">
          Saves this workspace&rsquo;s layout: sections, cards and their settings, removed and hidden cards, hide
          patterns, defaults, prefs and whether unlisted metrics get automatic cards (off: the automatic cards shown
          now are saved as cards). Applying one replaces the layout of the workspace you are in (the run page or a
          comparison); its runs stay.
        </p>
        {error && <p className="text-xs text-status-failed">{error}</p>}
        {views.isLoading ? (
          <p className="text-xs text-fg-muted">Loading…</p>
        ) : (views.data?.views.length ?? 0) === 0 ? (
          <p className="text-xs text-fg-muted">No saved views yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border">
            {views.data!.views.map((v) => (
              <li key={v.id} className="flex items-center gap-2 px-2 py-1">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-sm text-fg hover:text-accent disabled:opacity-50"
                  onClick={() => void apply(v.id, v.name)}
                  disabled={busy}
                  title={`Apply “${v.name}”`}
                >
                  {v.name}
                </button>
                {autoOf(v.id) != null && (
                  <span
                    className="shrink-0 text-[10px] text-fg-subtle"
                    title={autoOf(v.id) ? "Includes unlisted metrics" : "Only its listed cards"}
                    data-view-auto={autoOf(v.id) ? "on" : "off"}
                  >
                    {autoOf(v.id) ? "+ unlisted" : "listed only"}
                  </span>
                )}
                <button
                  type="button"
                  className="h-6 w-6 shrink-0 rounded text-fg-subtle hover:bg-bg-hover hover:text-status-failed touch:h-10 touch:w-10"
                  onClick={() => void remove(v.id, v.name)}
                  disabled={busy}
                  aria-label={`Delete view ${v.name}`}
                >
                  <i className="fa-solid fa-trash-can text-[11px]" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Popover>
    </>
  );
}
