/**
 * `run.define_metric(...)` definitions, as `GET /api/runs/{id}` returns them.
 * A definition's name is a metric name or an fnmatch glob (`val/*`); the
 * matching mirrors the server's `summary_rules.rule_for`: an exact name beats
 * a glob, and among globs the longest pattern wins.
 */

import type { MetricDef } from "../api/types.ts";

/** Python `fnmatch.fnmatchcase` as a RegExp: `*`, `?`, `[seq]`, `[!seq]`. */
export function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") out += ".*";
    else if (c === "?") out += ".";
    else if (c === "[") {
      const end = pattern.indexOf("]", i + 2);
      if (end < 0) {
        out += "\\[";
        continue;
      }
      let body = pattern.slice(i + 1, end);
      if (body.startsWith("!")) body = "^" + body.slice(1);
      out += `[${body.replace(/\\/g, "\\\\")}]`;
      i = end;
    } else out += c.replace(/[.+^${}()|\\/\]]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "s");
}

/** The definition that governs `name` among `defs` for which `has` holds. */
function defFor(
  name: string,
  defs: readonly MetricDef[],
  has: (d: MetricDef) => boolean,
): MetricDef | null {
  const candidates = defs.filter(has);
  const exact = candidates.find((d) => d.name === name);
  if (exact) return exact;
  let best: MetricDef | null = null;
  for (const d of candidates) {
    if (globToRegExp(d.name).test(name) && (!best || d.name.length > best.name.length)) {
      best = d;
    }
  }
  return best;
}

/** The x-axis series `define_metric(step_metric=...)` assigns to `name`. */
export function stepMetricFor(
  name: string,
  defs: readonly MetricDef[] | undefined,
): string | null {
  return defFor(name, defs ?? [], (d) => !!d.step_metric)?.step_metric ?? null;
}

/** The summary rule (`"min"`, `"max"`, `"mean"`, `"last"`) `define_metric(summary=...)` assigns to `name`. */
export function summaryRuleFor(
  name: string,
  defs: readonly MetricDef[] | undefined,
): string | null {
  return defFor(name, defs ?? [], (d) => !!d.summary)?.summary ?? null;
}
