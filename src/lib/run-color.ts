/**
 * A stable colour per run, derived from the run id (nothing is stored).
 *
 * Each run hashes (FNV-1a) to a slot in a 20-colour palette. Within one card,
 * runs are placed oldest first; a run whose slot an older run already took
 * probes onward (a second hash picks the stride), so the runs of one card are
 * always distinct while a run keeps its colour everywhere it is not displaced.
 * Beyond 20 runs colours repeat.
 */

export const RUN_PALETTE = [
  "#1f77b4", "#d62728", "#2ca02c", "#ff7f0e", "#9467bd",
  "#17becf", "#8c564b", "#e377c2", "#bcbd22", "#393b79",
  "#0b4f8a", "#9e1b1b", "#1b6e1b", "#b35900", "#5e3c99",
  "#0f7f8a", "#5c3a2e", "#a8457f", "#7d7e10", "#637939",
] as const;

/** Strides coprime with the palette size, so a probe visits every slot. */
const STRIDES = [1, 3, 7, 9, 11, 13, 17, 19];

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
  const out = new Map<string, string>();
  for (const id of order) {
    let slot = runColorSlot(id);
    if (taken.size < n) {
      const stride = STRIDES[fnv1a(`${id}#`) % STRIDES.length]!;
      while (taken.has(slot)) slot = (slot + stride) % n;
      taken.add(slot);
    }
    out.set(id, RUN_PALETTE[slot]!);
  }
  return out;
}
