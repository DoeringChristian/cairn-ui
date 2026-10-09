/**
 * A stable colour per run, derived from the run id (nothing is stored).
 *
 * The palette is 10 hues, each in a light and a dark shade. Each run hashes
 * (FNV-1a) to a preferred slot. Within one page (`assignPageColors`), runs
 * and group lines are placed oldest first;
 * a run whose hue an older run already took probes onward to a free hue (a
 * second hash picks the stride), so the first 10 lines of a page always get 10
 * different hues. Only then are the second shades used; beyond 20 runs colours
 * repeat. A run keeps its colour everywhere it is not displaced.
 */

/** Slot i and slot i + HUES are the same hue (light, then dark). */
export const RUN_PALETTE = [
  "#1f77b4", "#d62728", "#2ca02c", "#ff7f0e", "#9467bd",
  "#17becf", "#8c564b", "#e377c2", "#bcbd22", "#393b79",
  "#0b4f8a", "#9e1b1b", "#1b6e1b", "#b35900", "#5e3c99",
  "#0f7f8a", "#5c3a2e", "#a8457f", "#7d7e10", "#6b6ecf",
] as const;

const HUES = RUN_PALETTE.length / 2;

/** Strides coprime with the number of hues, so a probe visits every hue. */
const STRIDES = [1, 3, 7, 9];

export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The run's preferred palette slot. */
export function runColorSlot(runId: string): number {
  return fnv1a(runId) % RUN_PALETTE.length;
}

/** The run's colour when nothing displaces it. */
export function runColor(runId: string): string {
  return RUN_PALETTE[runColorSlot(runId)]!;
}

/** A line to colour: `seed` picks its preferred slot, `time` its precedence (older first keeps its slot). */
interface Entry {
  key: string;
  seed: string;
  time: number | undefined;
}

/**
 * The palette handed out in order, oldest first (ties by key): a free hue
 * first (keeping the entry's preferred shade), then any free slot; beyond 20
 * entries colours repeat. Continues over every `take` call, so entries taken
 * later never collide with earlier ones while the palette lasts.
 */
class Assigner {
  private readonly taken = new Set<number>();
  private readonly hueTaken = new Set<number>();

  take(entries: readonly Entry[], out: Map<string, string>): void {
    const n = RUN_PALETTE.length;
    const order = [...entries].sort((a, b) => {
      const ta = a.time ?? Infinity;
      const tb = b.time ?? Infinity;
      return ta !== tb ? ta - tb : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
    for (const e of order) {
      if (out.has(e.key)) continue;
      let slot = runColorSlot(e.seed);
      const stride = STRIDES[fnv1a(`${e.seed}#`) % STRIDES.length]!;
      if (this.hueTaken.size < HUES) {
        // A free hue first, keeping the preferred shade.
        const shade = slot >= HUES ? HUES : 0;
        let hue = slot % HUES;
        while (this.hueTaken.has(hue)) hue = (hue + stride) % HUES;
        slot = shade + hue;
      } else if (this.taken.size < n) {
        // All hues used: any free slot.
        while (this.taken.has(slot)) slot = (slot + stride) % n;
      }
      this.taken.add(slot);
      this.hueTaken.add(slot % HUES);
      out.set(e.key, RUN_PALETTE[slot]!);
    }
  }
}

/** One page's colours: every drawn run's and every innermost group line's. */
export interface PageColors {
  /** Run id → colour (runs averaged into a group line too, after every line: for cards that ungroup). */
  runs: Map<string, string>;
  /** Innermost group line (lib/runs-table/group.ts `groupLineLabel`) → colour. */
  groups: Map<string, string>;
}

/**
 * The colours of one page (the project workspace, the run page, a report
 * cell), computed once and used by its sidebar dots and every card. The
 * lines a page draws are its runs that are their own line (not grouped, or
 * under a `(none)`) and its innermost groups (`groupOf`: a run → the group
 * line it is averaged into); they share one palette, so no two collide while
 * it lasts (a run's preferred slot comes from its id, a group's from its
 * line label). Runs averaged into a group get no line colour of their own:
 * they are coloured after every line, from what is left.
 *
 * Stable: entries are placed oldest first (a group by its oldest run;
 * `createdAt`: unknown sorts last, ties by id), so a line keeps its
 * preferred colour unless an older one took it, and hiding or showing
 * newer lines never moves it.
 */
export function assignPageColors(
  runIds: readonly string[],
  groupOf: ReadonlyMap<string, string>,
  createdAt: (id: string) => number | undefined,
): PageColors {
  const ids = [...new Set(runIds)];
  const groupTime = new Map<string, number | undefined>();
  for (const id of ids) {
    const line = groupOf.get(id);
    if (line == null) continue;
    const t = createdAt(id);
    const prev = groupTime.get(line);
    groupTime.set(line, prev === undefined ? t : t === undefined ? prev : Math.min(prev, t));
  }
  const g = (line: string) => `g\u0000${line}`;
  const lines: Entry[] = [
    ...ids.filter((id) => !groupOf.has(id)).map((id) => ({ key: id, seed: id, time: createdAt(id) })),
    ...[...groupTime].map(([line, time]) => ({ key: g(line), seed: line, time })),
  ];
  const assigner = new Assigner();
  const all = new Map<string, string>();
  assigner.take(lines, all);
  assigner.take(ids.filter((id) => groupOf.has(id)).map((id) => ({ key: id, seed: id, time: createdAt(id) })), all);
  const runs = new Map<string, string>();
  for (const id of ids) runs.set(id, all.get(id)!);
  const groups = new Map<string, string>();
  for (const line of groupTime.keys()) groups.set(line, all.get(g(line))!);
  return { runs, groups };
}

const NO_GROUPS: ReadonlyMap<string, string> = new Map();

/**
 * Colours for runs shown together, none grouped (`assignPageColors`
 * without groups). `createdAt(id)` orders them (older first keeps its
 * slot); unknown times sort last, ties by id.
 */
export function assignRunColors(
  runIds: readonly string[],
  createdAt: (id: string) => number | undefined,
): Map<string, string> {
  return assignPageColors(runIds, NO_GROUPS, createdAt).runs;
}
