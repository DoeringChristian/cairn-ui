/**
 * Add a panel to a workspace section, or edit one: its card type, which
 * metrics it shows (one metric, several, or a regex over metric names) and
 * its section. The run page and comparisons use this same dialog (the "+"
 * on a section header, "Edit panel" on a card).
 *
 * The metric list comes from the workspace's bound runs; a regex is matched
 * against the whole name (`val/.*`), live-previewed below the field.
 */

import { useEffect, useMemo, useState } from "react";
import { CARD_TYPES, type CardType } from "../../lib/cards/card-spec";
import { isMultiRunCardType, MULTI_RUN_CARD_TYPES } from "../../lib/comparisons/types";
import type { MetricSelector, Panel } from "../../lib/workspace/doc";
import { compileSelectorRegex, type MetricInfo } from "../../lib/workspace/layout";
import { cardTypeLabel } from "../DefaultsEditor";
import Dialog, { DialogFooter } from "../ui/Dialog";

export interface PanelDialogResult {
  type: CardType;
  selector: MetricSelector;
  section: string;
}

type Mode = "one" | "several" | "regex";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Metrics of the bound runs. */
  metrics: readonly MetricInfo[];
  /** Existing section names (the section picker). */
  sections: readonly string[];
  /** The section a new panel goes to / the edited panel is in. */
  section: string;
  /** Edit this panel instead of adding one. */
  panel?: Panel | null;
  onSubmit: (r: PanelDialogResult) => void;
}

const NEW_SECTION = "\u0000new";

export default function PanelDialog({ open, onClose, metrics, sections, section, panel, onSubmit }: Props) {
  const editing = panel != null;
  const [type, setType] = useState<CardType>("scalar");
  const [mode, setMode] = useState<Mode>("one");
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [regex, setRegex] = useState("");
  const [target, setTarget] = useState(section);
  const [newSection, setNewSection] = useState("");

  // Reset whenever the dialog opens (or opens on another panel).
  useEffect(() => {
    if (!open) return;
    setFilter("");
    setTarget(section);
    setNewSection("");
    if (panel) {
      setType(panel.type);
      if ("regex" in panel.selector) {
        setMode("regex");
        setRegex(panel.selector.regex);
        setPicked([]);
      } else {
        setMode(panel.selector.names.length > 1 ? "several" : "one");
        setPicked(panel.selector.names);
        setRegex("");
      }
    } else {
      setType("scalar");
      setMode("one");
      setPicked([]);
      setRegex("");
    }
  }, [open, panel, section]);

  const types = useMemo(() => {
    if (editing) return [...CARD_TYPES];
    const present = new Set(metrics.map((m) => m.object_type));
    return [
      ...CARD_TYPES.filter((t) => present.has(t) && !isMultiRunCardType(t)),
      ...MULTI_RUN_CARD_TYPES,
    ];
  }, [metrics, editing]);

  const multiRun = isMultiRunCardType(type);
  // Adding: offer the metrics of the chosen type; editing: every metric.
  const candidates = useMemo(() => {
    const list = editing ? [...metrics] : metrics.filter((m) => m.object_type === type);
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [metrics, type, editing]);
  const q = filter.trim().toLowerCase();
  const shown = q ? candidates.filter((m) => m.name.toLowerCase().includes(q)) : candidates;

  const re = mode === "regex" && regex.trim() ? compileSelectorRegex(regex.trim()) : null;
  const regexError = mode === "regex" && regex.trim() !== "" && re == null;
  const regexMatches = re ? metrics.filter((m) => re.test(m.name)).map((m) => m.name).sort() : [];

  const sectionName = target === NEW_SECTION ? newSection.trim() : target;

  const submit = (selector: MetricSelector) => {
    if (!sectionName) return;
    onSubmit({ type, selector, section: sectionName });
    onClose();
  };

  const selectorNow = (): MetricSelector | null => {
    if (multiRun) return { names: [] };
    if (mode === "regex") return regex.trim() && !regexError ? { regex: regex.trim() } : null;
    return picked.length > 0 ? { names: picked } : null;
  };
  const ready = selectorNow() != null && sectionName !== "";

  const toggle = (name: string) =>
    setPicked((prev) => (mode === "one" ? [name] : prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  return (
    <Dialog open={open} onClose={onClose} title={editing ? "Edit panel" : `Add a panel to “${section}”`} size="2xl" fill>
      {/* Type */}
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4 py-2" role="tablist" aria-label="Card type">
        {types.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={type === t}
            onClick={() => setType(t)}
            className={`shrink-0 rounded px-3 py-1 text-xs font-medium transition-colors touch:min-h-10 ${
              type === t ? "bg-accent text-white" : "text-fg-muted hover:bg-bg-hover hover:text-fg"
            }`}
          >
            {cardTypeLabel(t)}
          </button>
        ))}
      </div>

      {/* Metric selector */}
      {multiRun ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 text-sm text-fg-muted">
          A {cardTypeLabel(type)} panel shows every run of the workspace; it picks its own metrics in its settings.
        </div>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
            {(["one", "several", "regex"] as const).map((m) => (
              <label key={m} className="inline-flex items-center gap-1 text-xs text-fg-muted">
                <input type="radio" name="panel-selector-mode" checked={mode === m} onChange={() => setMode(m)} />
                {m === "one" ? "One metric" : m === "several" ? "Several metrics" : "Regex"}
              </label>
            ))}
            {mode === "regex" ? (
              <input
                type="text"
                value={regex}
                onChange={(e) => setRegex(e.target.value)}
                placeholder="val/.*"
                aria-label="Metric regex"
                aria-invalid={regexError}
                className={`input mono min-w-0 flex-1 py-1 text-sm ${regexError ? "!border-status-failed" : ""}`}
              />
            ) : (
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter metrics…"
                aria-label="Filter metrics"
                className="input min-w-0 flex-1 py-1 text-sm"
              />
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {mode === "regex" ? (
              <div className="p-4 text-xs text-fg-muted">
                <p className="mb-2">
                  Matched against the whole metric name. The panel follows the pattern: a run that logs new matching
                  metrics shows them too.
                </p>
                {regexError ? (
                  <p className="text-status-failed">Not a valid regular expression.</p>
                ) : regexMatches.length === 0 ? (
                  <p>{regex.trim() ? "No metric of these runs matches (yet)." : ""}</p>
                ) : (
                  <ul className="mono space-y-0.5 text-fg" data-testid="regex-preview">
                    {regexMatches.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : shown.length === 0 ? (
              <div className="p-4 text-sm text-fg-muted">{q ? "No matching metrics." : "No metrics of this type in these runs."}</div>
            ) : (
              <div className="divide-y divide-border-subtle">
                {shown.map((m) => (
                  <label
                    key={m.name}
                    className="flex cursor-pointer items-center gap-2 px-4 py-2 text-sm text-fg hover:bg-bg-hover touch:min-h-10"
                  >
                    <input
                      type={mode === "one" ? "radio" : "checkbox"}
                      name="panel-metric"
                      checked={picked.includes(m.name)}
                      onChange={() => toggle(m.name)}
                    />
                    <span className="mono min-w-0 flex-1 truncate">{m.name}</span>
                    <span className="shrink-0 text-xs text-fg-subtle">
                      {m.runIds.length} run{m.runIds.length === 1 ? "" : "s"}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <DialogFooter>
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          Section
          <select className="input py-1 text-xs" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Section">
            {[...new Set([section, ...sections])].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value={NEW_SECTION}>New section…</option>
          </select>
          {target === NEW_SECTION && (
            <input
              className="input py-1 text-xs"
              value={newSection}
              onChange={(e) => setNewSection(e.target.value)}
              placeholder="Section name"
              aria-label="New section name"
            />
          )}
        </label>
        <button
          type="button"
          className="btn text-xs touch:min-h-10 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!ready}
          onClick={() => {
            const sel = selectorNow();
            if (sel) submit(sel);
          }}
        >
          {editing ? "Save panel" : "+ Add panel"}
        </button>
      </DialogFooter>
    </Dialog>
  );
}
