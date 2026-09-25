/**
 * A stable colour per run, derived from the run id (nothing is stored).
 *
 * The palette is 10 hues, each in a light and a dark shade. Each run hashes
 * (FNV-1a) to a preferred slot. Within one card, runs are placed oldest first;
 * a run whose hue an older run already took probes onward to a free hue (a
 * second hash picks the stride), so the first 10 runs of a card always get 10
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

/**
 * Colours for the runs shown together. `createdAt(id)` orders them (older
 * first keeps its slot); unknown times sort last, ties by id.
 */
export function assignRunColors(
  runIds: readonly string[],
  createdAt: (id: string) => number | undefined,
): Map<string, string> {
  const n = RUN_PALETTE.length;
  const order = [...new Set(runIds)].sort((a, b) => {
    const ta = createdAt(a) ?? Infinity;
    const tb = createdAt(b) ?? Infinity;
    return ta !== tb ? ta - tb : a < b ? -1 : a > b ? 1 : 0;
  });
  const taken = new Set<number>();
  const hueTaken = new Set<number>();
  const out = new Map<string, string>();
  for (const id of order) {
    let slot = runColorSlot(id);
    const stride = STRIDES[fnv1a(`${id}#`) % STRIDES.length]!;
    if (hueTaken.size < HUES) {
      // A free hue first, keeping the preferred shade.
      const shade = slot >= HUES ? HUES : 0;
      let hue = slot % HUES;
      while (hueTaken.has(hue)) hue = (hue + stride) % HUES;
      slot = shade + hue;
    } else if (taken.size < n) {
      // All hues used: any free slot.
      while (taken.has(slot)) slot = (slot + stride) % n;
    }
    taken.add(slot);
    hueTaken.add(slot % HUES);
    out.set(id, RUN_PALETTE[slot]!);
  }
  return out;
}
