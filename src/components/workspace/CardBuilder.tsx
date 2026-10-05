/**
 * The card builder: one dialog to add cards to a workspace, edit one, or
 * manage them all. The run page and comparisons open this same dialog
 * (WorkspaceView), on their own bound runs.
 *
 * Adding walks four steps:
 *
 * 1. **Data** — the series of the bound runs, grouped by section, with kind
 *    badges and the cards already showing each; pick one or several, or a
 *    regex (live match list), or "whole runs" for run-level cards.
 * 2. **Card type** — the types that can show that data
 *    (lib/workspace/card-builder.ts); several may be ticked, so one series
 *    becomes a line chart, a value and a bar chart side by side. The
 *    focused type shows a live preview on the bound runs.
 * 3. **Configure** — each new card's preview beside its own settings panel
 *    (the very panel its gear opens: `CardSettingsSlotContext`), edited on
 *    a draft; "another" adds a second card of the same type (two image cards
 *    of one series, with different settings).
 * 4. **Place** — the section (existing or new) and the titles.
 *
 * Editing opens on step 3 with the card's data, type and settings; any step
 * can be revisited. "Manage cards" lists every card of the workspace —
 * listed, hidden, automatic, removed and not shown — with show / hide, edit,
 * duplicate, move and delete.
 *
 * Previews render the real card components (PanelCard → CardRenderer) under
 * a draft settings store: nothing is written until "Add" / "Save". Only one
 * preview renders at a time.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import PanelCard from "./PanelCard";
import Dialog from "../ui/Dialog";
import {
  CardMutationContext,
  CardSettingsStoreContext,
  type CardOverrides,
  type CardSettingsKey,
  type CardSettingsStore,
} from "../../lib/card-settings";
import type { CardType } from "../../lib/cards/card-spec";
import { CardNavProvider } from "../../lib/card-nav";
import { ChartSyncProvider } from "../../lib/chart-sync";
import { NoUndo } from "../../lib/undo-context";
import { newLayoutId, type MetricSelector, type Panel } from "../../lib/workspace/doc";
import { panelLabel, resolvePanelMetrics, type MetricInfo, type RenderedPanel } from "../../lib/workspace/layout";
import { useViewerList } from "../../lib/custom/hooks";
import { useProjectId } from "../../lib/project-context";
import {
  builderTypeLabel,
  compatibleTypes,
  optionKey,
  optionLabel,
  parseOptionKey,
  dataLabel,
  dataMetrics,
  dataReady,
  defaultTitle,
  kindLabel,
  panelData,
  regexMatches,
  seedPanel,
  seriesCatalogue,
  type BuilderData,
  type CardStatus,
  type CatalogueEntry,
} from "../../lib/workspace/card-builder";
import { CardSettingsSlotContext, PanelActionsContext } from "../../lib/workspace/panel-actions";

export type BuilderMode =
  | { kind: "add"; section: string | null }
  | { kind: "edit"; panel: Panel; section: string; returnTo: "manage" | null }
  | { kind: "manage" };

/** A card the builder writes. */
export interface BuilderCard {
  type: CardType;
  selector: MetricSelector;
  settings: Record<string, unknown>;
}

export interface ManageActions {
  /** Show a hidden / removed / not-shown card, or hide a shown one. */
  toggle: (e: CatalogueEntry) => void;
  duplicate: (e: CatalogueEntry) => void;
  remove: (e: CatalogueEntry) => void;
  move: (e: CatalogueEntry, section: string) => void;
}

interface Props {
  mode: BuilderMode;
  onModeChange: (mode: BuilderMode | null) => void;
  metrics: readonly MetricInfo[];
  runIds: readonly string[];
  /** Metric → labels of the cards showing it (lib/workspace/card-builder `seriesShownBy`). */
  shownBy: ReadonlyMap<string, readonly string[]>;
  /** Section names, in page order. */
  sections: readonly string[];
  catalogue: readonly CatalogueEntry[];
  autoPanels: boolean;
  onToggleAutoPanels: () => void;
  onAdd: (section: string, cards: BuilderCard[]) => void;
  onSave: (panelId: string, card: BuilderCard, section: string) => void;
  manage: ManageActions;
}

/** Where "Add cards" from the toolbar puts new cards by default. */
export const DEFAULT_NEW_SECTION = "Custom panels";

export default function CardBuilder(props: Props) {
  const { mode, onModeChange } = props;
  const title =
    mode.kind === "manage" ? "Manage cards" : mode.kind === "edit" ? "Edit card" : "Add cards";
  const tabs =
    mode.kind === "edit" ? null : (
      <div className="flex shrink-0 gap-1 border-b border-border px-4 py-1.5" role="tablist" aria-label="Card builder">
        {(
          [
            ["add", "Add cards"],
            ["manage", "Manage cards"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={mode.kind === k}
            onClick={() => onModeChange(k === "add" ? { kind: "add", section: null } : { kind: "manage" })}
            className={`rounded px-3 py-1 text-xs font-medium touch:min-h-10 ${
              mode.kind === k ? "bg-accent text-white" : "text-fg-muted hover:bg-bg-hover hover:text-fg"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    );
  return (
    <Dialog open onClose={() => onModeChange(null)} title={title} size="6xl" fill>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="card-builder">
        {tabs}
        {mode.kind === "manage" ? (
          <ManageCards {...props} />
        ) : (
          <BuildFlow key={mode.kind === "edit" ? `edit:${mode.panel.id}` : `add:${mode.section ?? ""}`} {...props} mode={mode} />
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Add / edit
// ---------------------------------------------------------------------------

type Step = "data" | "type" | "configure" | "place";
const STEPS: Array<[Step, string]> = [
  ["data", "Data"],
  ["type", "Card type"],
  ["configure", "Configure"],
  ["place", "Place"],
];

interface Draft {
  key: string;
  type: CardType;
  settings: Record<string, unknown>;
  /** The card's label in the builder (its type, or its custom viewer's title). */
  label?: string;
}

const draftLabel = (d: Draft) => d.label ?? builderTypeLabel(d.type);

const NEW_SECTION = "\u0000new";
/** Settings a type change keeps (the card's frame, not its content). */
const FRAME_KEYS = ["title", "height", "colSpan", "collapsed"];

/** A title that is still its card's default (`loss · Value`) follows the data; one the user wrote stays. */
function followTitle(type: CardType, settings: Record<string, unknown>, data: BuilderData): Record<string, unknown> {
  const was = defaultTitle(type, panelData({ type, selector: { names: [] }, settings }));
  if (!was || settings.title !== was) return settings;
  const next = { ...settings };
  const now = defaultTitle(type, data);
  if (now) next.title = now;
  else delete next.title;
  return next;
}

const pick = (o: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => keys.includes(k)));

function BuildFlow(props: Props & { mode: Extract<BuilderMode, { kind: "add" | "edit" }> }) {
  const { mode, metrics, runIds, shownBy, sections, onAdd, onSave, onModeChange } = props;
  const editing = mode.kind === "edit" ? mode.panel : null;

  const [step, setStep] = useState<Step>(editing ? "configure" : "data");
  const [data, setData] = useState<BuilderData>(() => (editing ? panelData(editing) : { mode: "series", names: [] }));
  // Chosen options: card types, or `custom:<viewer>` (see optionKey).
  const editingKey = editing ? optionKey(editing.type, editing.settings) : null;
  const [types, setTypes] = useState<string[]>(() => (editingKey ? [editingKey] : []));
  const [focus, setFocus] = useState<string | null>(editingKey);
  const viewers = useViewerList(useProjectId()).data ?? [];
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    editing ? [{ key: editing.id, type: editing.type, settings: editing.settings }] : [],
  );
  const [active, setActive] = useState<string | null>(editing?.id ?? null);
  const initialSection = mode.kind === "edit" ? mode.section : mode.section;
  const [target, setTarget] = useState<string>(initialSection ?? NEW_SECTION);
  const [newSection, setNewSection] = useState(initialSection ? "" : DEFAULT_NEW_SECTION);

  const compat = useMemo(
    () => compatibleTypes(data, metrics, runIds.length, editingKey, viewers),
    [data, metrics, runIds.length, editingKey, viewers],
  );
  const available = compat.options.filter((o) => o.unavailable == null).map((o) => o.key);

  // The draft list for the chosen types: kept drafts follow the data; new types start seeded.
  const buildDrafts = (chosen: readonly string[]): Draft[] => {
    const out: Draft[] = [];
    for (const k of chosen) {
      const { type: t, seed } = parseOptionKey(k);
      const label = optionLabel(k, viewers);
      const kept = drafts.filter((d) => optionKey(d.type, d.settings) === k);
      if (kept.length) {
        for (const d of kept) out.push({ ...d, label, settings: seedPanel(t, data, followTitle(t, d.settings, data)).settings });
        continue;
      }
      if (editing && drafts[0]) {
        // Editing: the card changes type; it keeps its frame.
        const prev = drafts[0];
        const frame = pick(prev.settings, FRAME_KEYS);
        // A default title (`loss · Value`) is the old type's: the new type brings its own.
        const prevDefault = defaultTitle(prev.type, panelData({ type: prev.type, selector: { names: [] }, settings: prev.settings }));
        if (prevDefault && frame.title === prevDefault) delete frame.title;
        const title = defaultTitle(t, data);
        if (frame.title == null && title) frame.title = title;
        out.push({ key: drafts[0].key, type: t, label, settings: seedPanel(t, data, { ...frame, ...seed }).settings });
        continue;
      }
      const title = defaultTitle(t, data);
      out.push({ key: newLayoutId("d_"), type: t, label, settings: seedPanel(t, data, { ...(title ? { title } : {}), ...seed }).settings });
    }
    return out;
  };

  const goto = (next: Step) => {
    if (next === "type" && !editing && types.length === 0 && available.length > 0) {
      setTypes([available[0]!]);
      setFocus(available[0]!);
    }
    if (next === "type" && !focus) setFocus(types[0] ?? available[0] ?? null);
    if (next === "configure" || next === "place") {
      const chosen = types.filter((t) => available.includes(t));
      const nextDrafts = buildDrafts(chosen);
      setDrafts(nextDrafts);
      if (!nextDrafts.some((d) => d.key === active)) setActive(nextDrafts[0]?.key ?? null);
    }
    setStep(next);
  };

  const chosenOk = types.some((t) => available.includes(t));
  const reachable = (s: Step): boolean => {
    if (s === "data") return true;
    if (!dataReady(data) && data.mode !== "runs") return false;
    if (s === "type") return true;
    return chosenOk;
  };

  const sectionName = target === NEW_SECTION ? newSection.trim() : target;
  const cards = (): BuilderCard[] =>
    drafts.map((d) => {
      const seeded = seedPanel(d.type, data, d.settings);
      return { type: d.type, selector: seeded.selector, settings: seeded.settings };
    });
  const canSubmit = drafts.length > 0 && sectionName !== "" && (step === "configure" || step === "place");
  const submit = () => {
    if (!canSubmit) return;
    if (editing) {
      onSave(editing.id, cards()[0]!, sectionName);
      onModeChange(mode.kind === "edit" && mode.returnTo === "manage" ? { kind: "manage" } : null);
    } else {
      onAdd(sectionName, cards());
      onModeChange(null);
    }
  };

  const stepIndex = STEPS.findIndex(([s]) => s === step);
  const nextStep = STEPS[stepIndex + 1]?.[0];
  const prevStep = STEPS[stepIndex - 1]?.[0];

  return (
    <>
      <nav className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-2 text-xs" aria-label="Steps">
        {STEPS.map(([s, label], i) => (
          <button
            key={s}
            type="button"
            disabled={!reachable(s)}
            onClick={() => goto(s)}
            aria-current={s === step ? "step" : undefined}
            className={`inline-flex items-center gap-1.5 rounded px-2 py-1 touch:min-h-10 disabled:cursor-not-allowed disabled:opacity-40 ${
              s === step ? "bg-bg-hover font-semibold text-fg" : "text-fg-muted hover:text-fg"
            }`}
          >
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px]">{i + 1}</span>
            {label}
          </button>
        ))}
        <span className="ml-auto min-w-0 truncate text-fg-subtle" title={dataLabel(data)}>
          {dataReady(data) ? <span className="mono">{dataLabel(data)}</span> : "no data picked"}
          {types.length > 0 && step !== "data" && <> · {types.map((k) => optionLabel(k, viewers)).join(", ")}</>}
        </span>
      </nav>

      <div className="flex min-h-0 flex-1 flex-col">
        {step === "data" && <DataStep data={data} onChange={setData} metrics={metrics} shownBy={shownBy} />}
        {step === "type" && (
          <TypeStep
            options={compat.options}
            reason={compat.reason}
            single={!!editing}
            types={types}
            onTypes={setTypes}
            focus={focus}
            onFocus={setFocus}
            data={data}
            metrics={metrics}
            runIds={runIds}
          />
        )}
        {step === "configure" && (
          <ConfigureStep
            drafts={drafts}
            onDrafts={setDrafts}
            active={active}
            onActive={setActive}
            data={data}
            metrics={metrics}
            runIds={runIds}
            single={!!editing}
          />
        )}
        {step === "place" && (
          <PlaceStep
            sections={sections}
            target={target}
            onTarget={setTarget}
            newSection={newSection}
            onNewSection={setNewSection}
            drafts={drafts}
            onDrafts={setDrafts}
            data={data}
          />
        )}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-2">
        {step === "data" && <DataSummary data={data} metrics={metrics} />}
        {prevStep && (
          <button type="button" className="inline-flex items-center rounded px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-hover hover:text-fg touch:min-h-10" onClick={() => goto(prevStep)}>
            ← Back
          </button>
        )}
        {nextStep && (
          <button
            type="button"
            className="inline-flex items-center rounded px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-hover hover:text-fg touch:min-h-10 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!reachable(nextStep)}
            onClick={() => goto(nextStep)}
          >
            Next →
          </button>
        )}
        {(step === "configure" || step === "place") && (
          <button
            type="button"
            className="btn text-xs touch:min-h-10 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSubmit}
            onClick={submit}
            data-testid="card-builder-submit"
          >
            {editing ? "Save card" : `Add ${drafts.length} card${drafts.length === 1 ? "" : "s"} to “${sectionName || "…"}”`}
          </button>
        )}
      </div>
    </>
  );
}

function DataSummary({ data, metrics }: { data: BuilderData; metrics: readonly MetricInfo[] }) {
  const n = dataMetrics(data, metrics).length;
  return (
    <span className="mr-auto text-xs text-fg-muted">
      {data.mode === "runs" ? "Run-level cards: no series." : `${n} series picked`}
    </span>
  );
}

// --- step 1: data -------------------------------------------------------------

const KIND_BADGE = "shrink-0 rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted";

function ShownBy({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) return <span className="shrink-0 text-[11px] text-fg-subtle">no card</span>;
  return (
    <span className="shrink-0 text-[11px] text-fg-muted" title={`Shown by: ${labels.join("; ")}`}>
      in {labels.length} card{labels.length === 1 ? "" : "s"}
    </span>
  );
}

function DataStep({
  data,
  onChange,
  metrics,
  shownBy,
}: {
  data: BuilderData;
  onChange: (d: BuilderData) => void;
  metrics: readonly MetricInfo[];
  shownBy: ReadonlyMap<string, readonly string[]>;
}) {
  const [query, setQuery] = useState("");
  const [regexDraft, setRegexDraft] = useState(data.mode === "regex" ? data.regex : "");
  const groups = useMemo(() => seriesCatalogue(metrics, shownBy, query), [metrics, shownBy, query]);
  const picked = data.mode === "series" ? data.names : [];
  const kinds = new Map(metrics.map((m) => [m.name, m.object_type]));
  const regex = useMemo(() => (regexDraft.trim() ? regexMatches(regexDraft, metrics) : null), [regexDraft, metrics]);

  const toggle = (name: string) =>
    onChange({ mode: "series", names: picked.includes(name) ? picked.filter((n) => n !== name) : [...picked, name] });

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        {(
          [
            ["series", "Series"],
            ["regex", "Regex"],
            ["runs", "Whole runs"],
          ] as const
        ).map(([m, label]) => (
          <label key={m} className="inline-flex items-center gap-1 text-xs text-fg-muted">
            <input
              type="radio"
              name="builder-data-mode"
              checked={data.mode === m}
              onChange={() =>
                onChange(m === "series" ? { mode: "series", names: picked } : m === "regex" ? { mode: "regex", regex: regexDraft } : { mode: "runs" })
              }
            />
            {label}
          </label>
        ))}
        {data.mode === "series" && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search series…"
            aria-label="Search series"
            className="input min-w-0 flex-1 py-1 text-sm"
            autoFocus
          />
        )}
        {data.mode === "regex" && (
          <input
            type="text"
            value={regexDraft}
            onChange={(e) => {
              setRegexDraft(e.target.value);
              onChange({ mode: "regex", regex: e.target.value });
            }}
            placeholder="val\..*"
            aria-label="Series regex"
            aria-invalid={regex != null && !regex.ok}
            className={`input mono min-w-0 flex-1 py-1 text-sm ${regex && !regex.ok ? "!border-status-failed" : ""}`}
            autoFocus
          />
        )}
      </div>
      {data.mode === "series" && picked.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-border px-4 py-2" data-testid="builder-picked">
          {picked.map((n) => (
            <span key={n} className="inline-flex items-center gap-1 rounded-full border border-accent/50 bg-accent/10 px-2 py-0.5 text-xs">
              <span className="mono">{n}</span>
              <span className="text-[10px] text-fg-muted">{kindLabel(kinds.get(n) ?? "?")}</span>
              <button type="button" onClick={() => toggle(n)} aria-label={`Unpick ${n}`} className="text-fg-subtle hover:text-fg">
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {data.mode === "runs" && (
          <p className="p-4 text-sm text-fg-muted">
            Cards that compare whole runs rather than a series: the run comparer, the code diff, and the scatter, bar,
            value, parallel-coordinates and importance cards with their series picked in their settings.
          </p>
        )}
        {data.mode === "regex" && (
          <div className="p-4 text-xs text-fg-muted">
            <p className="mb-2">
              Matched against the whole series name. The card follows the pattern: series logged later that match it
              show up too.
            </p>
            {regex && !regex.ok ? (
              <p className="text-status-failed">{regex.error}</p>
            ) : regex?.ok && regex.matches.length === 0 ? (
              <p>No series of these runs matches (yet).</p>
            ) : (
              <ul className="space-y-0.5" data-testid="regex-preview">
                {(regex?.ok ? regex.matches : []).map((m) => (
                  <li key={m.name} className="flex items-center gap-2">
                    <span className="mono min-w-0 flex-1 truncate text-fg">{m.name}</span>
                    <span className={KIND_BADGE}>{kindLabel(m.object_type === "custom" && m.kind ? m.kind : m.object_type)}</span>
                    <ShownBy labels={shownBy.get(m.name) ?? []} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {data.mode === "series" &&
          (groups.length === 0 ? (
            <p className="p-4 text-sm text-fg-muted">{query ? "No series matches." : "These runs log no series yet."}</p>
          ) : (
            groups.map((g) => (
              <section key={g.name} aria-label={g.name}>
                <h4 className="sticky top-0 z-10 border-b border-border-subtle bg-bg px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                  {g.name} <span className="font-normal text-fg-subtle">{g.items.length}</span>
                </h4>
                <ul className="divide-y divide-border-subtle">
                  {g.items.map((it) => (
                    <li key={it.name}>
                      <label
                        className="flex cursor-pointer items-center gap-2 px-4 py-1.5 text-sm hover:bg-bg-hover touch:min-h-10"
                        data-series={it.name}
                      >
                        <input type="checkbox" checked={picked.includes(it.name)} onChange={() => toggle(it.name)} />
                        <span className="mono min-w-0 flex-1 truncate">{it.name}</span>
                        <span className={KIND_BADGE}>{kindLabel(it.kind)}</span>
                        <span className="w-14 shrink-0 text-right text-[11px] text-fg-subtle">
                          {it.runs} run{it.runs === 1 ? "" : "s"}
                        </span>
                        <span className="w-16 shrink-0 text-right">
                          <ShownBy labels={it.shownBy} />
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          ))}
      </div>
    </>
  );
}

// --- step 2: card type --------------------------------------------------------

function TypeStep({
  options,
  reason,
  single,
  types,
  onTypes,
  focus,
  onFocus,
  data,
  metrics,
  runIds,
}: {
  options: ReturnType<typeof compatibleTypes>["options"];
  reason: string | null;
  single: boolean;
  types: string[];
  onTypes: (t: string[]) => void;
  focus: string | null;
  onFocus: (t: string) => void;
  data: BuilderData;
  metrics: readonly MetricInfo[];
  runIds: readonly string[];
}) {
  const focused = options.find((o) => o.key === focus) ?? options[0] ?? null;
  const toggle = (t: string) => {
    onFocus(t);
    if (single) onTypes([t]);
    else onTypes(types.includes(t) ? types.filter((x) => x !== t) : [...types, t]);
  };
  const seeded = useMemo(() => {
    if (!focused) return null;
    const title = defaultTitle(focused.type, data);
    return seedPanel(focused.type, data, { ...(title ? { title } : {}), ...focused.seed });
  }, [focused, data]);

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="min-h-0 shrink-0 overflow-y-auto border-b border-border md:w-72 md:border-b-0 md:border-r">
        {reason && <p className="p-4 text-sm text-fg-muted">{reason}</p>}
        <ul className="divide-y divide-border-subtle" role="listbox" aria-label="Card types" aria-multiselectable={!single}>
          {options.map((o) => (
            <li key={o.key}>
              <div
                className={`flex items-start gap-2 px-3 py-2 text-sm ${focused?.key === o.key ? "bg-bg-hover" : ""}`}
                onMouseEnter={() => onFocus(o.key)}
              >
                <input
                  type={single ? "radio" : "checkbox"}
                  name="builder-type"
                  className="mt-0.5"
                  checked={types.includes(o.key)}
                  disabled={o.unavailable != null}
                  onChange={() => toggle(o.key)}
                  aria-label={o.label}
                  data-type={o.key}
                />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onFocus(o.key)}>
                  <span className={`block font-medium ${o.unavailable ? "text-fg-subtle" : "text-fg"}`}>
                    {o.icon && <i className={`fa-solid fa-${o.icon} mr-1.5 text-fg-muted`} aria-hidden="true" />}
                    {o.label}
                  </span>
                  <span className="block text-[11px] text-fg-muted">{o.hint}</span>
                  {o.unavailable && <span className="block text-[11px] text-status-failed">{o.unavailable}</span>}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="builder-type-preview">
        {focused && seeded ? (
          focused.unavailable ? (
            <p className="text-sm text-fg-muted">
              {focused.label}: {focused.unavailable}
              {focused.unavailable.startsWith("needs") && " — this card compares runs. Add it here and it shows once the workspace binds enough runs (a comparison)."}
            </p>
          ) : (
            <>
              <p className="mb-2 text-[11px] uppercase tracking-wide text-fg-subtle">Preview · {focused.label}</p>
              <CardPreview
                key={`type:${focused.key}`}
                draftKey={`type:${focused.key}`}
                type={focused.type}
                selector={seeded.selector}
                settings={seeded.settings}
                metrics={metrics}
                runIds={runIds}
                readOnly
              />
            </>
          )
        ) : null}
      </div>
    </div>
  );
}

// --- step 3: configure --------------------------------------------------------

function ConfigureStep({
  drafts,
  onDrafts,
  active,
  onActive,
  data,
  metrics,
  runIds,
  single,
}: {
  drafts: Draft[];
  onDrafts: (d: Draft[]) => void;
  active: string | null;
  onActive: (k: string) => void;
  data: BuilderData;
  metrics: readonly MetricInfo[];
  runIds: readonly string[];
  single: boolean;
}) {
  const draft = drafts.find((d) => d.key === active) ?? drafts[0] ?? null;
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const setSettings = (key: string, settings: Record<string, unknown>) =>
    onDrafts(draftsRef.current.map((d) => (d.key === key ? { ...d, settings } : d)));
  const another = (d: Draft) => {
    const copy: Draft = { key: newLayoutId("d_"), type: d.type, label: d.label, settings: structuredClone(d.settings) };
    const at = drafts.indexOf(d);
    onDrafts([...drafts.slice(0, at + 1), copy, ...drafts.slice(at + 1)]);
    onActive(copy.key);
  };
  if (!draft) return <p className="p-4 text-sm text-fg-muted">Pick a card type first.</p>;
  const seeded = seedPanel(draft.type, data, draft.settings);
  const titleOf = (d: Draft) => (typeof d.settings.title === "string" && d.settings.title) || draftLabel(d);
  const setTitle = (t: string) => {
    const next = { ...draft.settings };
    if (t) next.title = t;
    else delete next.title;
    setSettings(draft.key, next);
  };

  return (
    <>
      {!single && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-4 py-1.5" role="tablist" aria-label="New cards">
          {drafts.map((d, i) => (
            <span key={d.key} className="inline-flex items-center">
              <button
                type="button"
                role="tab"
                aria-selected={d.key === draft.key}
                onClick={() => onActive(d.key)}
                className={`rounded-l px-2.5 py-1 text-xs touch:min-h-10 ${
                  d.key === draft.key ? "bg-accent text-white" : "bg-bg-hover text-fg-muted hover:text-fg"
                }`}
                title={titleOf(d)}
              >
                {i + 1}. {draftLabel(d)}
              </button>
              <button
                type="button"
                onClick={() => another(d)}
                className="bg-bg-hover px-1.5 py-1 text-xs text-fg-muted hover:text-fg touch:min-h-10"
                aria-label={`Another ${draftLabel(d)} card`}
                title={`Another ${draftLabel(d)} card of the same data (its own settings)`}
              >
                <i className="fa-solid fa-clone" aria-hidden="true" />
              </button>
              <button
                type="button"
                disabled={drafts.length === 1}
                onClick={() => {
                  const rest = drafts.filter((x) => x.key !== d.key);
                  onDrafts(rest);
                  if (d.key === draft.key && rest[0]) onActive(rest[0].key);
                }}
                className="rounded-r bg-bg-hover px-1.5 py-1 text-xs text-fg-muted hover:text-status-failed disabled:opacity-40 touch:min-h-10"
                aria-label={`Drop card ${i + 1}`}
                title="Don't add this one"
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="builder-config-preview">
          <CardPreview
            key={draft.key}
            draftKey={draft.key}
            type={draft.type}
            selector={seeded.selector}
            settings={draft.settings}
            onSettings={(s) => setSettings(draft.key, s)}
            metrics={metrics}
            runIds={runIds}
            slot={slot}
          />
        </div>
        <div className="flex min-h-0 shrink-0 flex-col border-t border-border md:w-[22rem] md:border-l md:border-t-0">
          <label className="flex shrink-0 flex-col gap-1 border-b border-border p-3 text-xs text-fg-muted">
            Title
            <input
              className="input py-1 text-sm"
              value={typeof draft.settings.title === "string" ? draft.settings.title : ""}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="(the series name)"
              aria-label="Card title"
            />
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="builder-settings">
            <div
              ref={setSlot}
              className="empty:after:text-xs empty:after:text-fg-muted empty:after:content-['Settings_appear_once_the_card_renders.']"
            />
          </div>
        </div>
      </div>
    </>
  );
}

// --- step 4: place -----------------------------------------------------------

function PlaceStep({
  sections,
  target,
  onTarget,
  newSection,
  onNewSection,
  drafts,
  onDrafts,
  data,
}: {
  sections: readonly string[];
  target: string;
  onTarget: (s: string) => void;
  newSection: string;
  onNewSection: (s: string) => void;
  drafts: Draft[];
  onDrafts: (d: Draft[]) => void;
  data: BuilderData;
}) {
  const taken = target === NEW_SECTION && sections.includes(newSection.trim());
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          Section
          <select className="input w-auto py-1 text-sm" value={target} onChange={(e) => onTarget(e.target.value)} aria-label="Section">
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value={NEW_SECTION}>New section…</option>
          </select>
        </label>
        {target === NEW_SECTION && (
          <input
            className="input w-auto py-1 text-sm"
            value={newSection}
            onChange={(e) => onNewSection(e.target.value)}
            placeholder="Section name"
            aria-label="New section name"
          />
        )}
        {taken && <span className="text-xs text-fg-muted">That section exists: the cards go there.</span>}
      </div>
      <h4 className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
        {drafts.length} card{drafts.length === 1 ? "" : "s"} of <span className="mono normal-case">{dataLabel(data)}</span>
      </h4>
      <ul className="divide-y divide-border-subtle rounded border border-border">
        {drafts.map((d) => (
          <li key={d.key} className="flex items-center gap-2 px-3 py-1.5">
            <span className="w-40 shrink-0 text-xs text-fg-muted">{draftLabel(d)}</span>
            <input
              className="input min-w-0 flex-1 py-1 text-sm"
              value={typeof d.settings.title === "string" ? d.settings.title : ""}
              placeholder="(the series name)"
              aria-label={`Title of the ${draftLabel(d)} card`}
              onChange={(e) => {
                const settings = { ...d.settings };
                if (e.target.value) settings.title = e.target.value;
                else delete settings.title;
                onDrafts(drafts.map((x) => (x.key === d.key ? { ...x, settings } : x)));
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- live preview -------------------------------------------------------------

/**
 * A real card on the bound runs over a draft settings store. `readOnly`:
 * explore only (the type step); otherwise its settings edits go to
 * `onSettings` and its settings panel renders into `slot`.
 */
function CardPreview({
  draftKey,
  type,
  selector,
  settings,
  onSettings,
  metrics,
  runIds,
  slot = null,
  readOnly = false,
}: {
  draftKey: string;
  type: CardType;
  selector: MetricSelector;
  settings: Record<string, unknown>;
  onSettings?: (s: Record<string, unknown>) => void;
  metrics: readonly MetricInfo[];
  runIds: readonly string[];
  slot?: HTMLElement | null;
  readOnly?: boolean;
}) {
  const settingsRef = useRef<CardOverrides>(settings);
  const listeners = useRef(new Set<() => void>());
  const onSettingsRef = useRef(onSettings);
  onSettingsRef.current = onSettings;
  useEffect(() => {
    if (settingsRef.current === settings) return;
    settingsRef.current = settings;
    for (const fn of listeners.current) fn();
  }, [settings]);
  const store = useMemo<CardSettingsStore>(
    () => ({
      read: () => settingsRef.current,
      subscribe: (_k, fn) => {
        listeners.current.add(fn);
        return () => {
          listeners.current.delete(fn);
        };
      },
      write: (_k, next) => {
        settingsRef.current = next;
        for (const fn of listeners.current) fn();
        onSettingsRef.current?.(next);
      },
    }),
    [],
  );
  const settingsKey = useMemo<CardSettingsKey>(() => ({ runId: "card-builder", metricName: draftKey }), [draftKey]);
  const rendered = useMemo<RenderedPanel>(() => {
    const panel: Panel = { id: draftKey, type, selector, settings };
    const byName = new Map(metrics.map((m) => [m.name, m]));
    return { panel, auto: false, section: "", metrics: resolvePanelMetrics(panel, byName), label: panelLabel(panel) };
  }, [draftKey, type, selector, settings, metrics]);

  return (
    <PreviewFrame>
      <NoUndo>
        <CardMutationContext.Provider value={!readOnly}>
          <CardSettingsStoreContext.Provider value={store}>
            <CardSettingsSlotContext.Provider value={readOnly ? null : slot}>
              <PanelActionsContext.Provider value={null}>
                <ChartSyncProvider enabled={false}>
                  <CardNavProvider>
                    <PanelCard rendered={rendered} runIds={runIds} settingsKey={settingsKey} />
                  </CardNavProvider>
                </ChartSyncProvider>
              </PanelActionsContext.Provider>
            </CardSettingsSlotContext.Provider>
          </CardSettingsStoreContext.Provider>
        </CardMutationContext.Provider>
      </NoUndo>
    </PreviewFrame>
  );
}

function PreviewFrame({ children }: { children: ReactNode }) {
  // A one-column grid, so a card's `grid-column: span N` is harmless.
  return (
    <div className="grid grid-cols-1" data-testid="card-preview">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manage cards
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<CardStatus, string> = {
  listed: "shown",
  hidden: "hidden",
  auto: "automatic",
  removed: "removed",
  unlisted: "not shown",
};
const STATUS_TITLE: Record<CardStatus, string> = {
  listed: "A card of this workspace's layout",
  hidden: "Kept in the layout, not shown",
  auto: "Shown automatically for a series no card claims",
  removed: "An automatic card that was removed",
  unlisted: "Unlisted metrics are off: this series has no card",
};
const ICON = "inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-bg-hover hover:text-fg touch:h-10 touch:w-10";

function ManageCards(props: Props) {
  const { catalogue, sections, manage, onModeChange, autoPanels, onToggleAutoPanels } = props;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CardStatus | "all">("all");
  const q = query.trim().toLowerCase();
  const shown = catalogue.filter(
    (e) => (status === "all" || e.status === status) && (!q || e.label.toLowerCase().includes(q) || e.section.toLowerCase().includes(q)),
  );
  const bySection = new Map<string, CatalogueEntry[]>();
  for (const e of shown) bySection.set(e.section, [...(bySection.get(e.section) ?? []), e]);
  const counts = new Map<CardStatus, number>();
  for (const e of catalogue) counts.set(e.status, (counts.get(e.status) ?? 0) + 1);

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter cards…"
          aria-label="Filter cards"
          className="input min-w-[10rem] flex-1 py-1 text-sm"
        />
        {(["all", "listed", "auto", "hidden", "removed", "unlisted"] as const).map((s) =>
          s !== "all" && !counts.get(s) ? null : (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              aria-pressed={status === s}
              className={`rounded-full border px-2 py-0.5 text-xs touch:min-h-10 ${
                status === s ? "border-accent text-fg" : "border-border text-fg-muted hover:text-fg"
              }`}
            >
              {s === "all" ? `all ${catalogue.length}` : `${STATUS_LABEL[s]} ${counts.get(s)}`}
            </button>
          ),
        )}
        <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-fg-muted" title="Metrics no card shows get automatic cards">
          <input type="checkbox" checked={autoPanels} onChange={onToggleAutoPanels} data-testid="manage-auto-panels" />
          Include unlisted metrics
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="manage-cards">
        {shown.length === 0 && <p className="p-4 text-sm text-fg-muted">No cards match.</p>}
        {[...bySection.entries()].map(([section, entries]) => (
          <section key={section} aria-label={section}>
            <h4 className="sticky top-0 z-10 border-b border-border-subtle bg-bg px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
              {section}
            </h4>
            <ul className="divide-y divide-border-subtle">
              {entries.map((e) => (
                <ManageRow
                  key={e.key}
                  entry={e}
                  sections={sections}
                  manage={manage}
                  onEdit={() => onModeChange({ kind: "edit", panel: e.panel, section: e.section, returnTo: "manage" })}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function ManageRow({
  entry: e,
  sections,
  manage,
  onEdit,
}: {
  entry: CatalogueEntry;
  sections: readonly string[];
  manage: ManageActions;
  onEdit: () => void;
}) {
  const visible = e.status === "listed" || e.status === "auto";
  const inLayout = e.status === "listed" || e.status === "hidden" || e.status === "auto";
  const dim = !visible;
  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-1.5 text-sm" data-card-entry={e.panel.id} data-status={e.status}>
      <button
        type="button"
        className={ICON}
        onClick={() => manage.toggle(e)}
        aria-label={visible ? `Hide ${e.label}` : `Show ${e.label}`}
        title={visible ? "Hide" : "Show"}
      >
        <i className={`fa-solid ${visible ? "fa-eye" : "fa-eye-slash"}`} aria-hidden="true" />
      </button>
      <span className={`mono min-w-0 flex-1 truncate ${dim ? "text-fg-subtle" : "text-fg"}`} title={e.label}>
        {e.label}
      </span>
      <span className={KIND_BADGE}>{builderTypeLabel(e.panel.type)}</span>
      <span className="w-20 shrink-0 text-[11px] text-fg-muted" title={STATUS_TITLE[e.status]}>
        {STATUS_LABEL[e.status]}
      </span>
      {e.patternHidden && (
        <span className="shrink-0 text-[11px] text-fg-subtle" title="A hide pattern of the toolbar hides it">
          <i className="fa-solid fa-filter" aria-hidden="true" /> pattern
        </span>
      )}
      {inLayout && (
        <>
          <button type="button" className={ICON} onClick={onEdit} aria-label={`Edit ${e.label}`} title="Edit">
            <i className="fa-solid fa-pen-to-square" aria-hidden="true" />
          </button>
          <button type="button" className={ICON} onClick={() => manage.duplicate(e)} aria-label={`Duplicate ${e.label}`} title="Duplicate">
            <i className="fa-solid fa-clone" aria-hidden="true" />
          </button>
          <select
            className="input w-32 py-0.5 text-xs"
            value=""
            onChange={(ev) => {
              const to = ev.target.value === NEW_SECTION ? prompt("New section name:")?.trim() : ev.target.value;
              if (to) manage.move(e, to);
            }}
            aria-label={`Move ${e.label} to section`}
          >
            <option value="">Move to…</option>
            {sections
              .filter((s) => s !== e.section)
              .map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            <option value={NEW_SECTION}>New section…</option>
          </select>
        </>
      )}
      {(e.status === "listed" || e.status === "hidden") && (
        <button
          type="button"
          className={`${ICON} hover:!text-status-failed`}
          onClick={() => manage.remove(e)}
          aria-label={`Delete ${e.label}`}
          title="Delete"
        >
          <i className="fa-solid fa-trash-can" aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

