/**
 * The workspace's hover highlight: hovering a run row in the sidebar
 * highlights its line(s) in every chart (the others dimmed), hovering a
 * line in a chart highlights its row. Grouped, a run's lines are its
 * innermost group's aggregate: hovering an innermost group header, or a run
 * inside it, targets the group's line, and hovering that line highlights
 * the group header.
 *
 * One small store per page (`RunHoverContext`, provided by the
 * workspace); without a provider (the run page, reports) charts
 * keep only their own legend highlight.
 */

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

/** A run's lines (`runId`) or a group's aggregate line (`group`, an innermost group's line label). */
export type HoverTarget = { runId: string; group?: undefined } | { group: string; runId?: undefined };

export const sameTarget = (a: HoverTarget | null, b: HoverTarget | null): boolean =>
  a === b || (a != null && b != null && a.runId === b.runId && a.group === b.group);

/** What a sidebar run row targets: its group's line when it is aggregated into one (`groupOf`), else its own. */
export function targetOfRun(runId: string, groupOf: ReadonlyMap<string, string> | null): HoverTarget {
  const group = groupOf?.get(runId);
  return group != null ? { group } : { runId };
}

/** What a chart line targets: its group, else its run; null for a line of neither (a single run's metrics). */
export function targetOfLine(line: { runId?: string; group?: string }): HoverTarget | null {
  if (line.group != null) return { group: line.group };
  if (line.runId != null) return { runId: line.runId };
  return null;
}

/** Whether a chart line is one the target highlights. */
export function lineMatches(line: { runId?: string; group?: string }, t: HoverTarget): boolean {
  return t.group != null ? line.group === t.group : line.runId === t.runId;
}

export class RunHoverStore {
  private target: HoverTarget | null = null;
  private listeners = new Set<() => void>();

  get = (): HoverTarget | null => this.target;

  set = (t: HoverTarget | null): void => {
    if (sameTarget(this.target, t)) return;
    this.target = t;
    for (const fn of this.listeners) fn();
  };

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
}

export const RunHoverContext = createContext<RunHoverStore | null>(null);

const noSubscribe = () => () => {};
const noTarget = () => null;
const noSet = () => {};

/** The hovered target and its setter (null target, no-op setter without a provider). */
export function useRunHover(): { target: HoverTarget | null; set: (t: HoverTarget | null) => void; active: boolean } {
  const store = useContext(RunHoverContext);
  const target = useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.get ?? noTarget);
  const set = useCallback((t: HoverTarget | null) => (store ?? { set: noSet }).set(t), [store]);
  return { target, set, active: store != null };
}
