/**
 * Windowing for the runs table (lib/runs-table/window.ts has the math):
 * `useRowWindow` renders only the rows near the viewport of whatever
 * scrolls them (the page, or the workspace sidebar), measuring each row it
 * renders; `useColumnWindow` renders only the scrolling columns near the
 * horizontal viewport of the Runs page's table. Both re-render only when
 * the view leaves the rendered range.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { nextWindow, padding, prefixSums, type Range } from "../../lib/runs-table/window";

/** The attribute a windowed row carries: its index in the list. */
export const ROW_INDEX_ATTR = "data-vi";

/** The nearest ancestor that scrolls vertically, or null (the page). */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** Calls `fn` (in an animation frame) on any scroll, and on resize. */
function useScrollFrames(fn: () => void, enabled: boolean) {
  const ref = useRef(fn);
  ref.current = fn;
  useLayoutEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const on = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        ref.current();
      });
    };
    // Capture: element scrolls (the sidebar, the table's horizontal scroll) do not bubble.
    window.addEventListener("scroll", on, { passive: true, capture: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on, { capture: true });
      window.removeEventListener("resize", on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [enabled]);
}

export interface RowWindow extends Range {
  before: number;
  after: number;
  /** The element whose children are the rows (`tbody`, `ul`). */
  ref: (el: HTMLElement | null) => void;
}

/**
 * Window `keys.length` rows (a row's key names its measured height). Rows
 * not measured yet are as tall as the measured rows of their `kind` on
 * average (else `estimate(kind)`). `gap`: space between rows (a flex list).
 * Disabled: every row, no spacers.
 */
export function useRowWindow({
  keys,
  kindOf,
  estimate,
  enabled,
  overscan,
  gap = 0,
}: {
  keys: readonly string[];
  kindOf: (i: number) => string;
  estimate: (kind: string) => number;
  enabled: boolean;
  overscan: number;
  gap?: number;
}): RowWindow {
  const n = keys.length;
  const heights = useRef(new Map<string, number>());
  const [version, setVersion] = useState(0);
  const el = useRef<HTMLElement | null>(null);
  const [range, setRange] = useState<Range | null>(null);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const offsets = useMemo(() => {
    if (!enabled) return null;
    const sum = new Map<string, [number, number]>();
    for (let i = 0; i < n; i++) {
      const h = heights.current.get(keys[i]!);
      if (h === undefined) continue;
      const k = kindOf(i);
      const s = sum.get(k) ?? [0, 0];
      s[0] += h;
      s[1]++;
      sum.set(k, s);
    }
    const avg = (k: string) => {
      const s = sum.get(k);
      return s ? s[0] / s[1] : estimate(k);
    };
    const sizes = new Array<number>(n);
    for (let i = 0; i < n; i++) sizes[i] = (heights.current.get(keys[i]!) ?? avg(kindOf(i))) + gap;
    return prefixSums(sizes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, keys, version, gap]);

  const update = useCallback(() => {
    const body = el.current;
    if (!body || !offsets) return;
    const rect = body.getBoundingClientRect();
    let top = 0;
    let bottom = window.innerHeight;
    const sp = scrollParent(body);
    if (sp) {
      const r = sp.getBoundingClientRect();
      top = Math.max(top, r.top);
      bottom = Math.min(bottom, r.bottom);
    }
    // A focused row (a tag being typed) stays rendered.
    const focused = document.activeElement?.closest(`[${ROW_INDEX_ATTR}]`);
    const keep = focused && body.contains(focused) ? Number(focused.getAttribute(ROW_INDEX_ATTR)) : null;
    const next = nextWindow(offsets, top - rect.top, bottom - rect.top, overscan, rangeRef.current, keep);
    if (next !== rangeRef.current) {
      rangeRef.current = next;
      setRange(next);
    }
  }, [offsets, overscan]);

  // After each render: measure the rendered rows, then place the window.
  useLayoutEffect(() => {
    const body = el.current;
    if (!enabled || !body) return;
    let changed = false;
    for (const child of body.children) {
      const i = child.getAttribute(ROW_INDEX_ATTR);
      if (i === null) continue;
      const key = keys[Number(i)];
      if (key === undefined) continue;
      const h = (child as HTMLElement).getBoundingClientRect().height;
      const old = heights.current.get(key);
      if (old === undefined || Math.abs(old - h) > 0.5) {
        heights.current.set(key, h);
        changed = true;
      }
    }
    if (changed) setVersion((v) => v + 1);
    else update();
  });
  useScrollFrames(update, enabled);

  const ref = useCallback((node: HTMLElement | null) => {
    el.current = node;
  }, []);
  if (!enabled || !offsets) return { start: 0, end: n, before: 0, after: 0, ref };
  // Before the first placement: the top rows (laid out, measured and replaced before paint).
  const r = range && range.end <= n ? range : { start: 0, end: Math.min(n, 30) };
  const pad = padding(offsets, r);
  return { ...r, before: Math.max(0, pad.before - (r.start > 0 ? gap : 0)), after: Math.max(0, pad.after - (r.end < n ? gap : 0)), ref };
}

export interface ColumnWindow extends Range {
  before: number;
  after: number;
}

/**
 * Window the scrolling columns (`widths`) of a table inside `scroller`,
 * whose left `frozen` px (lead, Name, pinned columns) never scroll.
 * Disabled: every column.
 */
export function useColumnWindow({
  widths,
  scroller,
  frozen,
  enabled,
  overscan,
}: {
  widths: readonly number[];
  scroller: () => HTMLElement | null;
  frozen: number;
  enabled: boolean;
  overscan: number;
}): ColumnWindow {
  const n = widths.length;
  const offsets = useMemo(() => (enabled ? prefixSums(widths) : null), [enabled, widths]);
  const [range, setRange] = useState<Range | null>(null);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const update = useCallback(() => {
    const el = scroller();
    if (!el || !offsets) return;
    const lo = el.scrollLeft;
    const hi = lo + Math.max(0, el.clientWidth - frozen);
    const next = nextWindow(offsets, lo, hi, overscan, rangeRef.current);
    if (next !== rangeRef.current) {
      rangeRef.current = next;
      setRange(next);
    }
  }, [offsets, scroller, frozen, overscan]);
  useLayoutEffect(() => {
    if (enabled) update();
  });
  useScrollFrames(update, enabled);
  if (!enabled || !offsets) return { start: 0, end: n, before: 0, after: 0 };
  const r = range && range.end <= n ? range : { start: 0, end: Math.min(n, 12) };
  return { ...r, ...padding(offsets, r) };
}
