/**
 * The quick panel builder (pure): one regex over the metric names builds
 * scalar cards. Metrics whose capture groups agree share a card, so
 * `(train|val)\.loss` makes one card per split and `.*\.(loss|acc)` puts
 * `train.loss` and `val.loss` on one card and the two accuracies on another.
 * Without capture groups every match lands on one card.
 *
 * The regex must match the whole name (it is anchored), case-sensitively:
 * metric names are identifiers, and a builder that silently caught
 * `val_loss_ema` for `val.loss` would be surprising.
 */

export interface BuiltPanel {
  /** The capture-group values joined by " · ", or the pattern when there are none. */
  title: string;
  /** Matched metric names, sorted. */
  metrics: string[];
}

export type PanelBuildResult =
  | { ok: true; panels: BuiltPanel[] }
  | { ok: false; error: string };

export function buildPanels(pattern: string, metricNames: readonly string[]): PanelBuildResult {
  const p = pattern.trim();
  if (!p) return { ok: false, error: "Enter a regular expression" };
  let re: RegExp;
  try {
    re = new RegExp(`^(?:${p})$`);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const groups = new Map<string, string[]>();
  for (const name of Array.from(new Set(metricNames)).sort()) {
    const m = re.exec(name);
    if (!m) continue;
    const captures = m.slice(1);
    const key = captures.length === 0 ? p : captures.map((c) => c ?? "").join(" · ");
    const list = groups.get(key) ?? [];
    list.push(name);
    groups.set(key, list);
  }
  const panels = Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, metrics]) => ({ title, metrics }));
  return { ok: true, panels };
}
