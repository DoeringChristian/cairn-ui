// ---------------------------------------------------------------------------
// WebGL context budget for Plotly plots — the pure core.
//
// A browser keeps a fixed number of live WebGL contexts per page (16 in
// Chrome); creating one more silently kills the oldest, and the plot that
// owned it goes blank. Every Plotly WebGL plot holds its own contexts (each
// 3D scene one, the shared 2D WebGL layer two, parcoords three), and
// `Plotly.purge` does not give them back — they linger until garbage
// collection. So the page keeps a budget: only the plots that matter most
// (hovered, on screen, near the screen, recently used) are live; the rest are
// purged, their contexts released, and shown as a snapshot until needed.
//
// This module decides *which* plots are live; charts/gl-budget-manager.ts
// does the DOM side (visibility tracking, snapshots, purging). Pure: no DOM,
// no plotly.js, so it runs under `node --test`.
// ---------------------------------------------------------------------------

/**
 * WebGL contexts the managed Plotly plots may hold together. Chrome's page
 * limit is 16; the remainder covers the app's other WebGL views (point
 * clouds, meshes, volumes) and Plotly's short-lived helper contexts.
 */
export const GL_CONTEXT_BUDGET = 10;

/** The budget never shrinks below this after unexpected context losses. */
export const GL_CONTEXT_BUDGET_MIN = 4;

/** Trace types Plotly draws with WebGL (no SVG fallback). */
export const GL_3D_TYPES = new Set(["scatter3d", "surface", "mesh3d", "cone", "streamtube", "isosurface", "volume"]);
/** Trace types drawn on the plot's shared 2D WebGL layer. */
export const GL_2D_TYPES = new Set(["scattergl", "splom", "scatterpolargl", "parcoords"]);
/** Map traces: one WebGL context per map subplot. */
export const GL_MAP_TYPES = new Set(["scattermap", "choroplethmap", "densitymap", "scattermapbox", "choroplethmapbox", "densitymapbox"]);

/** Whether a trace type draws with WebGL. */
export function isGlTraceType(type: unknown): boolean {
  return typeof type === "string" && (GL_3D_TYPES.has(type) || GL_2D_TYPES.has(type) || GL_MAP_TYPES.has(type));
}

/**
 * The WebGL contexts a figure will hold once drawn (0 = an SVG-only plot,
 * which the budget leaves alone). Measured against Plotly 3.5: each 3D scene
 * and each map takes one; the 2D WebGL layer (scattergl, splom,
 * scatterpolargl) takes two, three once a parcoords trace is present.
 */
export function glContextEstimate(data: ReadonlyArray<Record<string, unknown>>): number {
  const scenes = new Set<string>();
  const maps = new Set<string>();
  let layer2d = 0;
  for (const t of data) {
    const type = t.type;
    if (typeof type !== "string") continue;
    if (GL_3D_TYPES.has(type)) scenes.add((t.scene as string | undefined) ?? "scene");
    else if (GL_MAP_TYPES.has(type)) maps.add((t.subplot as string | undefined) ?? (type.endsWith("mapbox") ? "mapbox" : "map"));
    else if (type === "parcoords") layer2d = 3;
    else if (GL_2D_TYPES.has(type)) layer2d = Math.max(layer2d, 2);
  }
  return scenes.size + maps.size + layer2d;
}

/** How much a plot wants to be live, from its place on the page. */
export const Visibility = {
  /** Off screen (or hidden). */
  Away: 0,
  /** Within about a screen of the viewport: about to scroll in. */
  Near: 1,
  /** In the viewport. */
  Visible: 2,
} as const;
export type Visibility = (typeof Visibility)[keyof typeof Visibility];

export interface BudgetEntry {
  id: number;
  /** WebGL contexts the plot holds while live. */
  weight: number;
  visibility: Visibility;
  /** Hovered or being interacted with: always first. */
  pinned: boolean;
  /** Currently holding its contexts. */
  live: boolean;
  /** Last time the plot came into view or was used (monotonic). */
  lastUse: number;
  /**
   * Lost its context unexpectedly: not reactivated on visibility alone
   * (whatever took the context would take it again) — only once it is used
   * or scrolled back into view.
   */
  dormant?: boolean;
}

export interface BudgetPlan {
  /** Every entry that should be live. */
  live: Set<number>;
  /** Entries to bring up (not live now). */
  activate: number[];
  /** Entries to release (live now). */
  deactivate: number[];
}

/**
 * The live set within `budget` contexts.
 *
 * Wanted plots (pinned, visible, near) are ranked pinned → visible → near,
 * then live before not (no churn between equally placed plots), then most
 * recently used. They are taken greedily while their contexts fit; a single
 * plot heavier than the whole budget is still taken when it ranks first.
 * Plots no longer wanted stay live while there is room (scrolling back is
 * then free) and are released most-stale first.
 */
export function planBudget(entries: readonly BudgetEntry[], budget: number): BudgetPlan {
  const wanted = entries.filter((e) => e.pinned || (e.visibility > Visibility.Away && !e.dormant));
  wanted.sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) ||
    b.visibility - a.visibility ||
    Number(b.live) - Number(a.live) ||
    b.lastUse - a.lastUse ||
    a.id - b.id);
  const wantedIds = new Set(wanted.map((e) => e.id));
  const lingering = entries
    .filter((e) => e.live && !wantedIds.has(e.id))
    .sort((a, b) => b.lastUse - a.lastUse || a.id - b.id);

  const live = new Set<number>();
  let used = 0;
  for (const e of wanted) {
    if (used + e.weight <= budget || live.size === 0) {
      live.add(e.id);
      used += e.weight;
    }
  }
  for (const e of lingering) {
    if (used + e.weight <= budget) {
      live.add(e.id);
      used += e.weight;
    }
  }
  return {
    live,
    activate: entries.filter((e) => !e.live && live.has(e.id)).map((e) => e.id),
    deactivate: entries.filter((e) => e.live && !live.has(e.id)).map((e) => e.id),
  };
}
