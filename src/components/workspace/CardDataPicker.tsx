/**
 * The one data picker of a workspace card (the card editor's "Data", while
 * adding and in the gear alike): the series of the bound runs grouped by
 * section, with kind badges and the cards already showing each ("in N");
 * picked series as chips; an anchored regex with its live matches; one card
 * per capture group (only while adding: it makes several cards); or whole
 * runs for run-level cards. Pure UI over lib/workspace/card-builder.ts.
 */

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { captureGroups, kindLabel, regexMatches, seriesCatalogue, type CardData } from "../../lib/workspace/card-builder";
import type { MetricInfo } from "../../lib/workspace/layout";

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

export default function CardDataPicker({
  data,
  onChange,
  metrics,
  shownBy,
  allowGroups,
  onSubmit,
  autoFocus = false,
}: {
  data: CardData;
  onChange: (d: CardData) => void;
  metrics: readonly MetricInfo[];
  /** Metric → labels of the cards showing it (card-builder `seriesShownBy`). */
  shownBy: ReadonlyMap<string, readonly string[]>;
  /** Offer "One card per group" (adding only: it makes several cards). */
  allowGroups: boolean;
  /** Enter in the search or regex field. */
  onSubmit?: () => void;
  autoFocus?: boolean;
}) {
  const radioName = useId();
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
  const setMode = (m: CardData["mode"]) =>
    onChange(m === "series" ? { mode: "series", names: picked } : m === "runs" ? { mode: "runs" } : { mode: m, regex: regexDraft });
  const enter = (e: KeyboardEvent) => {
    if (e.key === "Enter" && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };
  const bad = (regex != null && !regex.ok) || (split != null && !split.ok);

  return (
    <div className="space-y-2" data-testid="card-data-picker">
      <div className="flex flex-wrap gap-x-3 gap-y-1" role="radiogroup" aria-label="Data">
        {MODES.filter(([m]) => allowGroups || m !== "groups").map(([m, label]) => (
          <label key={m} className="inline-flex items-center gap-1 text-xs text-fg-muted touch:min-h-10">
            <input type="radio" name={radioName} checked={data.mode === m} onChange={() => setMode(m)} data-mode={m} />
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
          autoFocus={autoFocus}
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
          autoFocus={autoFocus}
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
            <ul className="max-h-[40vh] space-y-0.5 overflow-y-auto" data-testid="regex-preview">
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
            <ul className="max-h-[40vh] divide-y divide-border-subtle overflow-y-auto rounded border border-border" data-testid="groups-preview">
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
          <div className="max-h-[50vh] overflow-y-auto rounded border border-border-subtle" data-testid="series-catalogue">
            {groups.map((g) => (
              <section key={g.name} aria-label={g.name}>
                <h4 className="sticky top-0 z-[1] border-b border-border-subtle bg-bg-elevated px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                  {g.name} <span className="font-normal text-fg-subtle">{g.items.length}</span>
                </h4>
                <ul className="divide-y divide-border-subtle">
                  {g.items.map((it) => (
                    <li key={it.name}>
                      <label
                        className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-bg-hover touch:min-h-10"
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
