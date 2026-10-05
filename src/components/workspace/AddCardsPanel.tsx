/**
 * Adding cards: the panel a + of the workspace layout opens, anchored at
 * that + (a bottom sheet on phones). Which + was pressed decides where the
 * cards go: a section header's +, or the dashed "+ Add card" tile ending a
 * section's grid, both add to that section. The run page and comparisons
 * open the same panel (WorkspaceView), on their own bound runs.
 *
 * 1. **Data** — the series of the bound runs, grouped by section, with kind
 *    badges and the cards already showing each; pick one or several (chips),
 *    a regex (live match list), one card per capture group of a regex
 *    (previewing the cards), or whole runs for run-level cards
 *    (lib/workspace/add-cards.ts).
 * 2. **Card type** — the types that can show that data, custom viewers
 *    included, each with a live thumbnail on the bound runs. Clicking one
 *    adds its card(s); ticking several adds one card of each.
 *
 * The cards land at the end of the section and a single new card opens in
 * its editor (the gear) — `onAdd` does both.
 */

import { useMemo, useState, type RefObject } from "react";
import Popover from "../ui/Popover";
import CardPreview from "./CardPreview";
import { useViewerList } from "../../lib/custom/hooks";
import { useProjectId } from "../../lib/project-context";
import { kindLabel, regexMatches, seriesCatalogue, type TypeOption } from "../../lib/workspace/card-builder";
import {
  addCompatibleTypes,
  addDataLabel,
  addDataMetrics,
  addDataParts,
  addDataReady,
  captureGroups,
  newCards,
  type AddData,
  type NewCard,
} from "../../lib/workspace/add-cards";
import type { MetricInfo } from "../../lib/workspace/layout";

interface Props {
  /** The section the cards go to. */
  section: string;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  metrics: readonly MetricInfo[];
  runIds: readonly string[];
  /** Metric → labels of the cards showing it (lib/workspace/card-builder `seriesShownBy`). */
  shownBy: ReadonlyMap<string, readonly string[]>;
  onAdd: (cards: NewCard[]) => void;
}

type Step = "data" | "type";

const STEP_BTN =
  "inline-flex items-center gap-1.5 rounded px-2 py-1 touch:min-h-10 disabled:cursor-not-allowed disabled:opacity-40";
const FOOT_BTN =
  "inline-flex items-center rounded px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-hover hover:text-fg touch:min-h-10 disabled:cursor-not-allowed disabled:opacity-50";

export default function AddCardsPanel({ section, anchorRef, onClose, metrics, runIds, shownBy, onAdd }: Props) {
  const [step, setStep] = useState<Step>("data");
  const [data, setData] = useState<AddData>({ mode: "series", names: [] });
  const [ticked, setTicked] = useState<string[]>([]);
  const viewers = useViewerList(useProjectId()).data ?? [];
  const ready = addDataReady(data, metrics);
  const compat = useMemo(
    () => (step === "type" ? addCompatibleTypes(data, metrics, runIds.length, viewers) : null),
    [step, data, metrics, runIds.length, viewers],
  );
  const available = compat?.options.filter((o) => o.unavailable == null).map((o) => o.key) ?? [];
  const chosen = ticked.filter((k) => available.includes(k));

  const add = (keys: readonly string[]) => {
    const cards = newCards(data, keys, metrics);
    if (cards.length === 0) return;
    onAdd(cards);
  };
  const next = () => {
    if (!ready) return;
    setTicked([]);
    setStep("type");
  };
  const total = chosen.length * addDataParts(data, metrics).length;

  return (
    <Popover
      open
      onClose={onClose}
      anchorRef={anchorRef}
      title={`Add cards to “${section}”`}
      titleAnchored
      width={760}
      align="start"
      bodyClassName="flex flex-col"
    >
      <div className="flex min-h-0 flex-col" data-testid="add-cards-panel" data-section={section}>
        <nav className="-mt-1 flex shrink-0 items-center gap-1 border-b border-border px-3 pb-2 text-xs" aria-label="Steps">
          {(
            [
              ["data", "Data"],
              ["type", "Card type"],
            ] as const
          ).map(([s, label], i) => (
            <button
              key={s}
              type="button"
              disabled={s === "type" && !ready}
              onClick={() => (s === "type" ? next() : setStep("data"))}
              aria-current={s === step ? "step" : undefined}
              className={`${STEP_BTN} ${s === step ? "bg-bg-hover font-semibold text-fg" : "text-fg-muted hover:text-fg"}`}
            >
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px]">{i + 1}</span>
              {label}
            </button>
          ))}
          <span className="ml-auto min-w-0 truncate text-fg-subtle" title={addDataLabel(data, metrics)}>
            {ready ? <span className="mono">{addDataLabel(data, metrics)}</span> : "no data picked"}
          </span>
        </nav>

        {step === "data" ? (
          <DataStep data={data} onChange={setData} metrics={metrics} shownBy={shownBy} onSubmit={next} />
        ) : (
          <TypeStep
            options={compat?.options ?? []}
            reason={compat?.reason ?? null}
            ticked={ticked}
            onTicked={setTicked}
            onPick={(k) => add([k])}
            data={data}
            metrics={metrics}
            runIds={runIds}
          />
        )}

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-3 pt-2">
          {step === "data" ? (
            <>
              <span className="mr-auto text-xs text-fg-muted">
                {data.mode === "runs" ? "Run-level cards: no series." : `${addDataMetrics(data, metrics).length} series picked`}
              </span>
              <button type="button" className={FOOT_BTN} disabled={!ready} onClick={next} data-testid="add-cards-next">
                Next: card type →
              </button>
            </>
          ) : (
            <>
              <button type="button" className={`${FOOT_BTN} mr-auto`} onClick={() => setStep("data")}>
                ← Data
              </button>
              <span className="text-xs text-fg-muted">Click a type to add it{chosen.length ? "" : ", or tick several"}.</span>
              {chosen.length > 0 && (
                <button type="button" className="btn text-xs touch:min-h-10" onClick={() => add(chosen)} data-testid="add-cards-submit">
                  Add {total} card{total === 1 ? "" : "s"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Popover>
  );
}

// --- step 1: data -------------------------------------------------------------

const KIND_BADGE = "shrink-0 rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted";
const LIST = "max-h-[min(50vh,24rem)] min-h-0 overflow-y-auto";

function ShownBy({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) return <span className="shrink-0 text-[11px] text-fg-subtle">no card</span>;
  return (
    <span className="shrink-0 text-[11px] text-fg-muted" title={`Shown by: ${labels.join("; ")}`}>
      in {labels.length} card{labels.length === 1 ? "" : "s"}
    </span>
  );
}

const MODES = [
  ["series", "Series"],
  ["regex", "Regex"],
  ["groups", "One card per group"],
  ["runs", "Whole runs"],
] as const;

function DataStep({
  data,
  onChange,
  metrics,
  shownBy,
  onSubmit,
}: {
  data: AddData;
  onChange: (d: AddData) => void;
  metrics: readonly MetricInfo[];
  shownBy: ReadonlyMap<string, readonly string[]>;
  onSubmit: () => void;
}) {
  const [query, setQuery] = useState("");
  const [names, setNames] = useState<string[]>(data.mode === "series" ? data.names : []);
  const [regexDraft, setRegexDraft] = useState(data.mode === "regex" || data.mode === "groups" ? data.regex : "");
  const groups = useMemo(() => seriesCatalogue(metrics, shownBy, query), [metrics, shownBy, query]);
  const picked = data.mode === "series" ? data.names : names;
  const kinds = new Map(metrics.map((m) => [m.name, m.object_type === "custom" && m.kind ? m.kind : m.object_type]));
  const regex = useMemo(() => (data.mode === "regex" && regexDraft.trim() ? regexMatches(regexDraft, metrics) : null), [data.mode, regexDraft, metrics]);
  const split = useMemo(() => (data.mode === "groups" && regexDraft.trim() ? captureGroups(regexDraft, metrics) : null), [data.mode, regexDraft, metrics]);

  const toggle = (name: string) => {
    const next = picked.includes(name) ? picked.filter((n) => n !== name) : [...picked, name];
    setNames(next);
    onChange({ mode: "series", names: next });
  };
  const setMode = (m: AddData["mode"]) =>
    onChange(m === "series" ? { mode: "series", names } : m === "runs" ? { mode: "runs" } : { mode: m, regex: regexDraft });
  const enter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2" role="radiogroup" aria-label="Data">
        {MODES.map(([m, label]) => (
          <label key={m} className="inline-flex items-center gap-1 text-xs text-fg-muted">
            <input type="radio" name="add-cards-data-mode" checked={data.mode === m} onChange={() => setMode(m)} data-mode={m} />
            {label}
          </label>
        ))}
      </div>
      <div className="shrink-0 px-3 py-2">
        {data.mode === "series" && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={enter}
            placeholder="Search series…"
            aria-label="Search series"
            className="input w-full py-1 text-sm"
            autoFocus
          />
        )}
        {(data.mode === "regex" || data.mode === "groups") && (
          <input
            type="text"
            value={regexDraft}
            onChange={(e) => {
              setRegexDraft(e.target.value);
              onChange({ mode: data.mode as "regex" | "groups", regex: e.target.value });
            }}
            onKeyDown={enter}
            placeholder={data.mode === "groups" ? "(train|val)\\.loss" : "val\\..*"}
            aria-label={data.mode === "groups" ? "Capture-group regex" : "Series regex"}
            aria-invalid={(regex != null && !regex.ok) || (split != null && !split.ok)}
            className={`input mono w-full py-1 text-sm ${(regex && !regex.ok) || (split && !split.ok) ? "!border-status-failed" : ""}`}
            autoFocus
          />
        )}
        {data.mode === "runs" && (
          <p className="text-sm text-fg-muted">
            Cards that compare whole runs rather than a series: the run comparer, the code diff, and the scatter, bar,
            value, parallel-coordinates and importance cards with their series picked in their settings.
          </p>
        )}
      </div>
      {data.mode === "series" && picked.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-border px-3 pb-2" data-testid="builder-picked">
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
      {data.mode === "regex" && (
        <div className={`${LIST} px-3 pb-2 text-xs text-fg-muted`}>
          <p className="mb-2">
            Matched against the whole series name. The card follows the pattern: series logged later that match it show up too.
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
                  <span className={KIND_BADGE}>{kindLabel(kinds.get(m.name) ?? m.object_type)}</span>
                  <ShownBy labels={shownBy.get(m.name) ?? []} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {data.mode === "groups" && (
        <div className={`${LIST} px-3 pb-2 text-xs text-fg-muted`}>
          <p className="mb-2">
            Matched against the whole series name. Series whose capture groups agree share a card, titled by them:{" "}
            <code className="mono">(train|val)\.loss</code> makes one card per split, <code className="mono">.*\.(loss|acc)</code>{" "}
            one with every loss and one with every accuracy. Without groups, every match is on one card.
          </p>
          {split && !split.ok ? (
            <p className="text-status-failed">{split.error}</p>
          ) : split?.ok && split.groups.length === 0 ? (
            <p>No series of these runs matches (yet).</p>
          ) : (
            <ul className="divide-y divide-border-subtle rounded border border-border" data-testid="groups-preview">
              {(split?.ok ? split.groups : []).map((g) => (
                <li key={g.title} className="px-2 py-1.5" data-group={g.title}>
                  <div className="font-medium text-fg">{g.title}</div>
                  <div className="mono truncate" title={g.names.join(", ")}>
                    {g.names.join(", ")}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {data.mode === "series" && (
        <div className={`${LIST} border-t border-border-subtle`}>
          {groups.length === 0 ? (
            <p className="p-3 text-sm text-fg-muted">{query ? "No series matches." : "These runs log no series yet."}</p>
          ) : (
            groups.map((g) => (
              <section key={g.name} aria-label={g.name}>
                <h4 className="sticky top-0 z-10 border-b border-border-subtle bg-bg-elevated px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                  {g.name} <span className="font-normal text-fg-subtle">{g.items.length}</span>
                </h4>
                <ul className="divide-y divide-border-subtle">
                  {g.items.map((it) => (
                    <li key={it.name}>
                      <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-bg-hover touch:min-h-10" data-series={it.name}>
                        <input type="checkbox" checked={picked.includes(it.name)} onChange={() => toggle(it.name)} />
                        <span className="mono min-w-0 flex-1 truncate">{it.name}</span>
                        <span className={KIND_BADGE}>{kindLabel(kinds.get(it.name) ?? it.kind)}</span>
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
          )}
        </div>
      )}
    </>
  );
}

// --- step 2: card type --------------------------------------------------------

function TypeStep({
  options,
  reason,
  ticked,
  onTicked,
  onPick,
  data,
  metrics,
  runIds,
}: {
  options: TypeOption[];
  reason: string | null;
  ticked: string[];
  onTicked: (t: string[]) => void;
  onPick: (key: string) => void;
  data: AddData;
  metrics: readonly MetricInfo[];
  runIds: readonly string[];
}) {
  // A thumbnail shows the first card the option would add (the first group's, for groups).
  const previews = useMemo(() => {
    const out = new Map<string, NewCard>();
    for (const o of options) {
      const c = o.unavailable == null ? newCards(data, [o.key], metrics)[0] : undefined;
      if (c) out.set(o.key, c);
    }
    return out;
  }, [options, data, metrics]);

  return (
    <div className={`${LIST} p-3`}>
      {reason && <p className="mb-2 text-sm text-fg-muted">{reason}</p>}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3" aria-label="Card types">
        {options.map((o) => {
          const preview = previews.get(o.key);
          const isTicked = ticked.includes(o.key);
          return (
            <li
              key={o.key}
              className={`relative flex flex-col overflow-hidden rounded border ${
                isTicked ? "border-accent" : "border-border"
              } ${o.unavailable ? "opacity-60" : "hover:border-accent"}`}
              data-type-option={o.key}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 flex-col text-left disabled:cursor-not-allowed"
                disabled={o.unavailable != null}
                onClick={() => onPick(o.key)}
                title={o.unavailable ? `${o.label}: ${o.unavailable}` : `Add a ${o.label} card`}
                data-testid="add-card-type"
                data-type={o.key}
              >
                <div className="h-28 w-full border-b border-border-subtle bg-bg">
                  {preview ? (
                    <CardPreview
                      draftKey={`thumb:${o.key}`}
                      type={preview.type}
                      selector={preview.selector}
                      settings={preview.settings}
                      metrics={metrics}
                      runIds={runIds}
                      scale={0.45}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center p-2 text-center text-[11px] text-fg-subtle">
                      {o.unavailable}
                    </div>
                  )}
                </div>
                <span className="block px-2 pt-1.5 text-sm font-medium text-fg">
                  {o.icon && <i className={`fa-solid fa-${o.icon} mr-1.5 text-fg-muted`} aria-hidden="true" />}
                  {o.label}
                </span>
                <span className="block px-2 pb-1.5 text-[11px] text-fg-muted">{o.hint}</span>
              </button>
              {o.unavailable == null && (
                <input
                  type="checkbox"
                  className="absolute right-2 top-2"
                  checked={isTicked}
                  onChange={() => onTicked(isTicked ? ticked.filter((x) => x !== o.key) : [...ticked, o.key])}
                  aria-label={`Tick ${o.label}`}
                  title="Tick several types to add one card of each"
                  data-tick={o.key}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
