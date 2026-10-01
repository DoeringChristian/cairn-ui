// ---------------------------------------------------------------------------
// The page's WebGL budget for Plotly plots — the DOM side.
//
// lib/plot-utils/gl-budget.ts decides which plots are live; this module
// feeds it (where each plot sits relative to the viewport, which plot is
// hovered, how many contexts each one really holds) and carries the plan out
// by calling each plot's `activate` / `deactivate`, deactivations first so
// the live total never exceeds the budget.
//
// It also tracks every WebGL context the page creates (a thin wrapper around
// `HTMLCanvasElement.prototype.getContext`, weakly held), because Plotly
// never releases its contexts itself: `releaseGl` loses them explicitly.
// ---------------------------------------------------------------------------

import {
  GL_CONTEXT_BUDGET,
  GL_CONTEXT_BUDGET_MIN,
  planBudget,
  Visibility,
  type BudgetEntry,
} from "../lib/plot-utils/gl-budget.ts";

type GLContext = WebGLRenderingContext | WebGL2RenderingContext;

const contextOf = new WeakMap<HTMLCanvasElement, GLContext>();
let created = 0;
/** Canvases holding a WebGL context that has not been lost yet. */
const tracked = new Set<HTMLCanvasElement>();

/**
 * Plotly sometimes drops a plot's canvas from the page without losing its
 * context (seen with 3D scenes), and such a context keeps counting against
 * the browser's limit until garbage collection — long enough to push live
 * plots out. Every couple of seconds, a context whose canvas has been out of
 * the document for two sweeps in a row is lost on purpose. (Every WebGL
 * view in the app attaches its canvas as soon as it creates it.)
 */
const SWEEP_MS = 2000;
let sweeper: ReturnType<typeof setInterval> | null = null;
const detachedOnce = new WeakSet<HTMLCanvasElement>();
let swept = 0;
function startSweeper(): void {
  if (sweeper != null || typeof window === "undefined") return;
  sweeper = setInterval(() => {
    for (const canvas of tracked) {
      const ctx = contextOf.get(canvas);
      if (!ctx || ctx.isContextLost()) {
        tracked.delete(canvas);
        continue;
      }
      if (canvas.isConnected) {
        detachedOnce.delete(canvas);
      } else if (detachedOnce.has(canvas)) {
        loseContexts([ctx]);
        tracked.delete(canvas);
        swept++;
      } else {
        detachedOnce.add(canvas);
      }
    }
    if (tracked.size === 0) {
      clearInterval(sweeper!);
      sweeper = null;
    }
  }, SWEEP_MS);
}

function trackContexts(): void {
  if (typeof HTMLCanvasElement === "undefined") return;
  const proto = HTMLCanvasElement.prototype as HTMLCanvasElement & { __cairnGlTracked?: boolean };
  if (proto.__cairnGlTracked) return;
  proto.__cairnGlTracked = true;
  const original = proto.getContext;
  proto.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    const ctx = (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    if (ctx && /webgl/.test(type) && !contextOf.has(this)) {
      contextOf.set(this, ctx as GLContext);
      tracked.add(this);
      startSweeper();
      created++;
    }
    return ctx;
  } as typeof proto.getContext;
}
trackContexts();

/** Live WebGL contexts on canvases in the document (every owner, not only Plotly). */
export function liveGlContexts(): number {
  return glContextsIn(document.documentElement).length;
}

/** The live WebGL contexts drawn on canvases inside `el`. */
export function glContextsIn(el: Element): GLContext[] {
  const out: GLContext[] = [];
  for (const canvas of el.querySelectorAll("canvas")) {
    const ctx = contextOf.get(canvas);
    if (ctx && !ctx.isContextLost()) out.push(ctx);
  }
  return out;
}

/** Lose `contexts` now instead of whenever they are garbage collected. */
export function loseContexts(contexts: GLContext[]): void {
  for (const ctx of contexts) {
    try {
      if (!ctx.isContextLost()) ctx.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      // Already gone.
    }
  }
}

export interface GlPlotHandle {
  /** Draw the plot (it may now create its contexts). */
  activate(): void;
  /** Snapshot, purge and release the plot's contexts. */
  deactivate(): Promise<void>;
}

export interface GlRegistration {
  /** The contexts the plot holds (re-measured after each draw). */
  setWeight(weight: number): void;
  /** Hovered/used: rank first while pinned. */
  pin(pinned: boolean): void;
  /** Used now (click, wheel, drag): most recent. */
  touch(): void;
  /** The plot's contexts were lost by the browser: it is no longer live. */
  lost(): void;
  unregister(): void;
}

interface Entry extends BudgetEntry {
  el: HTMLElement;
  handle: GlPlotHandle;
  /** Activation or deactivation in flight. */
  busy: boolean;
}

/** Margin around the viewport within which a plot counts as "near". */
const NEAR_MARGIN = "100% 0px";

class GlBudgetManager {
  budget = GL_CONTEXT_BUDGET;
  private entries = new Map<number, Entry>();
  private byEl = new WeakMap<Element, Entry>();
  private nextId = 1;
  private clock = 0;
  private scheduled: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private dirty = false;
  private visibleIO?: IntersectionObserver;
  private nearIO?: IntersectionObserver;
  private inView = new WeakSet<Element>();
  private inNear = new WeakSet<Element>();

  private observers() {
    if (!this.visibleIO) {
      this.visibleIO = new IntersectionObserver((records) => this.onIntersect(records, this.inView), { threshold: 0 });
      this.nearIO = new IntersectionObserver((records) => this.onIntersect(records, this.inNear), { rootMargin: NEAR_MARGIN, threshold: 0 });
    }
    return { visible: this.visibleIO, near: this.nearIO! };
  }

  private onIntersect(records: IntersectionObserverEntry[], set: WeakSet<Element>) {
    for (const r of records) {
      if (r.isIntersecting) set.add(r.target);
      else set.delete(r.target);
      const e = this.byEl.get(r.target);
      if (!e) continue;
      const vis: Visibility = this.inView.has(r.target) ? Visibility.Visible : this.inNear.has(r.target) ? Visibility.Near : Visibility.Away;
      if (vis !== e.visibility) {
        // Coming (back) into view is a use, and wakes a dormant plot.
        if (vis > e.visibility) {
          e.lastUse = ++this.clock;
          if (vis === Visibility.Visible) e.dormant = false;
        }
        e.visibility = vis;
      }
    }
    this.schedule();
  }

  register(el: HTMLElement, handle: GlPlotHandle, weight: number): GlRegistration {
    const e: Entry = {
      id: this.nextId++, el, handle, weight: Math.max(1, weight), visibility: Visibility.Away,
      pinned: false, live: false, lastUse: ++this.clock, busy: false,
    };
    this.entries.set(e.id, e);
    this.byEl.set(el, e);
    const { visible, near } = this.observers();
    visible.observe(el);
    near.observe(el);
    return {
      setWeight: (w) => {
        const next = Math.max(1, w);
        if (next !== e.weight) {
          e.weight = next;
          this.schedule();
        }
      },
      pin: (p) => {
        if (p === e.pinned) return;
        e.pinned = p;
        e.lastUse = ++this.clock;
        if (p) e.dormant = false;
        this.schedule(p ? 0 : 150);
      },
      touch: () => {
        e.lastUse = ++this.clock;
        e.dormant = false;
        this.schedule(0);
      },
      lost: () => {
        if (!e.live) return;
        e.live = false;
        e.dormant = true;
        // Something else is using the page's contexts: leave it more room.
        this.budget = Math.max(GL_CONTEXT_BUDGET_MIN, this.budget - 1);
        this.schedule();
      },
      unregister: () => {
        this.entries.delete(e.id);
        this.byEl.delete(el);
        visible.unobserve(el);
        near.unobserve(el);
        e.live = false;
        this.schedule();
      },
    };
  }

  private schedule(delay = 50) {
    if (this.scheduled != null) {
      if (delay > 0) return;
      clearTimeout(this.scheduled);
    }
    this.scheduled = setTimeout(() => {
      this.scheduled = null;
      void this.reconcile();
    }, delay);
  }

  private async reconcile() {
    if (this.running) {
      this.dirty = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.dirty = false;
        const list = [...this.entries.values()];
        const plan = planBudget(list, this.budget);
        // Release first: the live total stays within the budget throughout.
        for (const id of plan.deactivate) {
          const e = this.entries.get(id);
          if (!e || !e.live) continue;
          e.busy = true;
          try {
            await e.handle.deactivate();
          } catch (err) {
            console.warn("gl-budget: deactivate failed", err);
          }
          e.busy = false;
          e.live = false;
        }
        for (const id of plan.activate) {
          const e = this.entries.get(id);
          if (!e || e.live) continue;
          e.live = true;
          e.lastUse = Math.max(e.lastUse, this.clock);
          try {
            e.handle.activate();
          } catch (err) {
            console.warn("gl-budget: activate failed", err);
          }
        }
      } while (this.dirty);
    } finally {
      this.running = false;
    }
  }

  /** Debug/verification snapshot of the budget. */
  stats() {
    const list = [...this.entries.values()];
    return {
      budget: this.budget,
      plots: list.length,
      livePlots: list.filter((e) => e.live).length,
      plotContexts: list.filter((e) => e.live).reduce((n, e) => n + e.weight, 0),
      pageContexts: liveGlContexts(),
      createdContexts: created,
      sweptContexts: swept,
    };
  }
}

export const glBudget = new GlBudgetManager();

if (typeof window !== "undefined") {
  (window as unknown as { __cairnGl?: unknown }).__cairnGl = { stats: () => glBudget.stats(), contextsIn: (el: Element) => glContextsIn(el).length };
}
