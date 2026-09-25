/**
 * The x-metric's value in effect at each step: an as-of join, so a point at
 * step s takes the x-metric's value at the largest step <= s (an `epoch`
 * logged once per epoch applies to every step until the next one). Steps
 * before the x-metric's first point have no value.
 */
export function asOfLookup<T = number>(
  xPoints: ReadonlyArray<{ step: number; scalar_value: T | null }>,
): (step: number) => T | null {
  const steps: number[] = [];
  const values: T[] = [];
  for (const p of [...xPoints].sort((a, b) => a.step - b.step)) {
    if (p.scalar_value == null) continue;
    steps.push(p.step);
    values.push(p.scalar_value);
  }
  return (step) => {
    let lo = 0;
    let hi = steps.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (steps[mid]! <= step) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found < 0 ? null : values[found]!;
  };
}
