/**
 * Adding cards to a workspace section. The one way to add a card is the
 * dashed "Add card" ghost card ending a section's grid: it opens this, and
 * the cards land at the end of that section. The run page and comparisons
 * open the same modal (WorkspaceView), on their own bound runs.
 *
 * It is the card editor's shell (CardDetailModal), at the same size and
 * layout: the live preview on the left, where the card is; the steps on the
 * right, where its settings are.
 *
 * 1. **Data** — the series of the bound runs, grouped by section, with kind
 *    badges and the cards already showing each; pick one or several (chips),
 *    a regex (live match list), one card per capture group of a regex, or
 *    whole runs for run-level cards (lib/workspace/add-cards.ts). The
 *    preview shows the picked data in the first type that fits (every
 *    group's card, for groups).
 * 2. **Card type** — the types that can show that data, custom viewers
 *    included; the preview shows each as a live card. Picking one creates
 *    the card(s) and turns, in place, into the new card's editor (the first
 *    one's, for several): this modal stays until that editor is open under
 *    it, then closes.
 */

import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import CardDetailModal from "../CardDetailModal";
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
  onClose: () => void;
  metrics: readonly MetricInfo[];
  runIds: readonly string[];
  /** Metric → labels of the cards showing it (lib/workspace/card-builder `seriesShownBy`). */
  shownBy: ReadonlyMap<string, readonly string[]>;
  /** Create the cards; returns the id of the one whose editor opens. */
  onAdd: (cards: NewCard[]) => string | undefined;
}

type Step = "data" | "type";

/** At most this many group cards preview at once. */
const MAX_PREVIEWS = 12;
/** Give up waiting for the new card's editor (this modal closes anyway). */
const HANDOVER_TIMEOUT_MS = 5000;

const STEP_BTN =
  "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs touch:min-h-10 disabled:cursor-not-allowed disabled:opacity-40";

export default function AddCardsModal({ section, onClose, metrics, runIds, shownBy, onAdd }: Props) {
  const [step, setStep] = useState<Step>("data");
  const [data, setData] = useState<AddData>({ mode: "series", names: [] });
  const [focus, setFocus] = useState<string | null>(null);
  const [handover, setHandover] = useState<string | null>(null);
  const viewers = useViewerList(useProjectId()).data ?? [];
  const ready = addDataReady(data, metrics);
  const compat = useMemo(() => addCompatibleTypes(data, metrics, runIds.length, viewers), [data, metrics, runIds.length, viewers]);
  const firstFit = compat.options.find((o) => o.unavailable == null) ?? null;
  const cardCount = addDataParts(data, metrics).length;

  // The hand-over: the new card's editor renders under this modal; once it is
  // in the page, this closes in the same frame (no flash, no size jump).
  useEffect(() => {
    if (!handover) return;
    const editorOpen = () => document.querySelector('[data-testid="panel-editor"]') != null;
    if (editorOpen()) {
      onClose();
      return;
    }
    const mo = new MutationObserver(() => {
      if (!editorOpen()) return;
      mo.disconnect();
      flushSync(onClose);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    const t = setTimeout(() => {
      mo.disconnect();
      onClose();
    }, HANDOVER_TIMEOUT_MS);
    return () => {
      mo.disconnect();
      clearTimeout(t);
    };
  }, [handover, onClose]);

  const pick = (key: string) => {
    if (handover) return;
    const id = onAdd(newCards(data, [key], metrics));
    if (id) setHandover(id);
    else onClose();
  };
  const next = () => {
    if (!ready) return;
    setFocus(null);
    setStep("type");
  };

  const steps = (
    <div className="flex min-h-full flex-col" data-testid="add-cards-modal" data-section={section}>
      <nav className="flex shrink-0 items-center gap-1 border-b border-border pb-2" aria-label="Steps">
        {(
          [
            ["data", "Data"],
            ["type", "Card type"],
          ] as const
        ).map(([s, label], i) => (
          <button
            key={s}
            type="button"
            disabled={(s === "type" && !ready) || handover != null}
            onClick={() => (s === "type" ? next() : setStep("data"))}
            aria-current={s === step ? "step" : undefined}
            className={`${STEP_BTN} ${s === step ? "bg-bg-hover font-semibold text-fg" : "text-fg-muted hover:text-fg"}`}
          >
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px]">{i + 1}</span>
            {label}
          </button>
        ))}
      </nav>
      <p className="mt-2 text-xs text-fg-muted">
        Into <span className="font-semibold text-fg">{section}</span>
        {ready && (
          <>
            {" · "}
            <span className="mono">{addDataLabel(data, metrics)}</span>
          </>
        )}
      </p>

      <div className="mt-3 flex-1">
        {step === "data" ? (
          <DataStep data={data} onChange={setData} metrics={metrics} shownBy={shownBy} onSubmit={next} />
        ) : (
          <TypeList options={compat.options} reason={compat.reason} focus={focus} onFocus={setFocus} onPick={pick} busy={handover != null} />
        )}
      </div>

      <div className="sticky bottom-0 -mx-4 -mb-4 mt-3 flex items-center gap-2 border-t border-border bg-bg-elevated px-4 py-2">
        {step === "data" ? (
          <>
            <span className="mr-auto text-xs text-fg-muted">
              {data.mode === "runs" ? "Run-level cards: no series." : `${addDataMetrics(data, metrics).length} series picked`}
            </span>
            <button
              type="button"
              className="btn text-xs touch:min-h-10 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!ready}
              onClick={next}
              data-testid="add-cards-next"
            >
              Next: card type →
            </button>
          </>
        ) : handover ? (
          <span className="text-xs text-fg-muted">
            <i className="fa-solid fa-spinner fa-spin mr-1.5" aria-hidden="true" />
            Opening the new card…
          </span>
        ) : (
          <>
            <button
              type="button"
              className="mr-auto inline-flex items-center rounded px-2 py-1 text-xs text-fg-muted hover:bg-bg-hover hover:text-fg touch:min-h-10"
              onClick={() => setStep("data")}
            >
              ← Data
            </button>
            <span className="text-xs text-fg-muted">{cardCount > 1 ? `Pick a type: ${cardCount} cards, the first opens in its editor.` : "Pick a type: the card opens in its editor."}</span>
          </>
        )}
      </div>
    </div>
  );

  return (
    <CardDetailModal
      open
      onClose={onClose}
      title={`Add a card to “${section}”`}
      settingsContent={steps}
      settingsLabel="Add a card"
      cardLabel="Preview"
    >
      {step === "data" ? (
        <DataPreview data={data} option={firstFit} metrics={metrics} runIds={runIds} />
      ) : (
        <TypePreviews
          options={compat.options}
          focus={focus}
          onFocus={setFocus}
          onPick={pick}
          busy={handover != null}
          data={data}
          metrics={metrics}
          runIds={runIds}
        />
      )}
    </CardDetailModal>
  );
}

// --- the preview (left) ---------------------------------------------------------

function DataPreview({
  data,
  option,
  metrics,
  runIds,
}: {
  data: AddData;
  option: TypeOption | null;
  metrics: readonly MetricInfo[];
  runIds: readonly string[];
}) {
  const cards = useMemo(() => (option ? newCards(data, [option.key], metrics) : []), [data, option, metrics]);
  if (!addDataReady(data, metrics)) {
    return <Hint>Pick the data to add: one or several series, a regex, one card per capture group, or whole runs.</Hint>;
  }
  if (!option || cards.length === 0) return <Hint>No card type shows this data. Pick other series.</Hint>;
  return (
    <div className="space-y-2" data-testid="add-cards-data-preview">
      <p className="text-[11px] uppercase tracking-wide text-fg-subtle">
        Preview · {option.label}
        {cards.length > 1 && ` · ${cards.length} cards`}
        {cards.length > MAX_PREVIEWS && ` (first ${MAX_PREVIEWS})`}
      </p>
      <div className={`grid gap-4 ${cards.length > 1 ? "lg:grid-cols-2" : "grid-cols-1"}`}>
        {cards.slice(0, MAX_PREVIEWS).map((c, i) => (
          <CardPreview
            key={`${option.key}:${i}`}
            draftKey={`add:${i}`}
            type={c.type}
            selector={c.selector}
            settings={c.settings}
            metrics={metrics}
            runIds={runIds}
          />
        ))}
      </div>
    </div>
  );
}

function TypePreviews({
  options,
  focus,
  onFocus,
  onPick,
  busy,
  data,
  metrics,
  runIds,
}: {
  options: TypeOption[];
  focus: string | null;
  onFocus: (k: string) => void;
  onPick: (k: string) => void;
  busy: boolean;
  data: AddData;
  metrics: readonly MetricInfo[];
  runIds: readonly string[];
}) {
  const first = useMemo(() => {
    const out = new Map<string, NewCard>();
    for (const o of options) {
      const c = o.unavailable == null ? newCards(data, [o.key], metrics)[0] : undefined;
      if (c) out.set(o.key, c);
    }
    return out;
  }, [options, data, metrics]);
  const avail = options.filter((o) => first.has(o.key));
  if (avail.length === 0) return <Hint>No card type shows this data.</Hint>;
  return (
    <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3" aria-label="Card type previews" data-testid="add-cards-type-previews">
      {avail.map((o) => {
        const c = first.get(o.key)!;
        return (
          <li key={o.key}>
            <button
              type="button"
              className={`block w-full overflow-hidden rounded-lg border text-left transition-colors disabled:cursor-wait ${
                focus === o.key ? "border-accent ring-1 ring-accent" : "border-border hover:border-accent"
              }`}
              onClick={() => onPick(o.key)}
              onMouseEnter={() => onFocus(o.key)}
              onFocus={() => onFocus(o.key)}
              disabled={busy}
              aria-label={`Add a ${o.label} card`}
              data-type-preview={o.key}
            >
              <span className="flex items-center gap-1.5 border-b border-border-subtle px-3 py-1.5 text-sm font-medium text-fg">
                {o.icon && <i className={`fa-solid fa-${o.icon} text-fg-muted`} aria-hidden="true" />}
                {o.label}
              </span>
              <span className="block h-64 bg-bg">
                <CardPreview
                  draftKey={`type:${o.key}`}
                  type={c.type}
                  selector={c.selector}
                  settings={c.settings}
                  metrics={metrics}
                  runIds={runIds}
                  scale={0.75}
                />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-40 items-center justify-center p-6 text-center text-sm text-fg-muted">{children}</div>;
}

// --- the steps (right) ------------------------------------------------------------

const KIND_BADGE = "shrink-0 rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted";

function ShownBy({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) return <span className="shrink-0 text-[11px] text-fg-subtle">no card</span>;
  return (
    <span className="shrink-0 text-[11px] text-fg-muted" title={`Shown by: ${labels.join("; ")}`}>
      in {labels.length}
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
  const enter = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSubmit();
    }
  };
  const bad = (regex != null && !regex.ok) || (split != null && !split.ok);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1" role="radiogroup" aria-label="Data">
        {MODES.map(([m, label]) => (
          <label key={m} className="inline-flex items-center gap-1 text-xs text-fg-muted">
            <input type="radio" name="add-cards-data-mode" checked={data.mode === m} onChange={() => setMode(m)} data-mode={m} />
            {label}
          </label>
        ))}
      </div>
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
          aria-invalid={bad}
          className={`input mono w-full py-1 text-sm ${bad ? "!border-status-failed" : ""}`}
          autoFocus
        />
      )}
      {data.mode === "runs" && (
        <p className="text-sm text-fg-muted">
          Cards that compare whole runs rather than a series: the run comparer, the code diff, and the scatter, bar, value,
          parallel-coordinates and importance cards with their series picked in their settings.
        </p>
      )}
      {data.mode === "series" && picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="builder-picked">
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
        <div className="text-xs text-fg-muted">
          <p className="mb-2">Matched against the whole series name. The card follows the pattern: series logged later that match it show up too.</p>
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
        <div className="text-xs text-fg-muted">
          <p className="mb-2">
            Matched against the whole series name. Series whose capture groups agree share a card, titled by them:{" "}
            <code className="mono">(train|val)\.loss</code> makes one card per split, <code className="mono">.*\.(loss|acc)</code> one
            with every loss and one with every accuracy. Without groups, every match is on one card.
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
      {data.mode === "series" &&
        (groups.length === 0 ? (
          <p className="text-sm text-fg-muted">{query ? "No series matches." : "These runs log no series yet."}</p>
        ) : (
          <div className="-mx-4 border-t border-border-subtle">
            {groups.map((g) => (
              <section key={g.name} aria-label={g.name}>
                <h4 className="border-b border-border-subtle px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
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
                        <span className="mono min-w-0 flex-1 truncate" title={`${it.name} · ${it.runs} run${it.runs === 1 ? "" : "s"}`}>
                          {it.name}
                        </span>
                        <span className={KIND_BADGE}>{kindLabel(kinds.get(it.name) ?? it.kind)}</span>
                        <ShownBy labels={it.shownBy} />
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ))}
    </div>
  );
}

function TypeList({
  options,
  reason,
  focus,
  onFocus,
  onPick,
  busy,
}: {
  options: TypeOption[];
  reason: string | null;
  focus: string | null;
  onFocus: (k: string) => void;
  onPick: (k: string) => void;
  busy: boolean;
}) {
  return (
    <div>
      {reason && <p className="mb-2 text-sm text-fg-muted">{reason}</p>}
      <ul className="-mx-4 divide-y divide-border-subtle border-y border-border-subtle" aria-label="Card types">
        {options.map((o) => (
          <li key={o.key}>
            <button
              type="button"
              className={`block w-full px-4 py-2 text-left disabled:cursor-not-allowed ${focus === o.key ? "bg-bg-hover" : "hover:bg-bg-hover"}`}
              disabled={o.unavailable != null || busy}
              onClick={() => onPick(o.key)}
              onMouseEnter={() => onFocus(o.key)}
              onFocus={() => onFocus(o.key)}
              data-testid="add-card-type"
              data-type={o.key}
            >
              <span className={`block text-sm font-medium ${o.unavailable ? "text-fg-subtle" : "text-fg"}`}>
                {o.icon && <i className={`fa-solid fa-${o.icon} mr-1.5 text-fg-muted`} aria-hidden="true" />}
                {o.label}
              </span>
              <span className="block text-[11px] text-fg-muted">{o.hint}</span>
              {o.unavailable && <span className="block text-[11px] text-status-failed">{o.unavailable}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
