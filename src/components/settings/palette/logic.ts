/**
 * Pure helpers behind the settings palette (no React, no DOM): field search
 * and regex matching, tab visibility, section names, number drafts and
 * colormap gradients. Tested in `logic.test.ts`.
 */
import { colorscale, type Colormap } from "../../../charts/colormaps.ts";

// ---------------------------------------------------------------------------
// Fields (FieldPicker / FieldMultiPicker)

export type FieldKind = "param" | "metric" | "expr";

export interface FieldOption {
  key: string;
  kind: FieldKind;
  label: string;
}

export const FIELD_KIND_ORDER: readonly FieldKind[] = ["param", "metric", "expr"];

export const FIELD_KIND_LABEL: Record<FieldKind, string> = {
  param: "Params",
  metric: "Metrics",
  expr: "Expressions",
};

export interface FieldMatcher {
  test: (option: FieldOption) => boolean;
  /** The regex's syntax error; the matcher then matches nothing. */
  error: string | null;
}

/**
 * Matcher for a search query. Plain mode: case-insensitive substring of the
 * label or key. Regex mode: case-insensitive `RegExp` search over the label
 * or key; an invalid pattern matches nothing and reports its error. An empty
 * query matches everything in both modes.
 */
export function fieldMatcher(query: string, regex: boolean): FieldMatcher {
  const q = query.trim();
  if (!q) return { test: () => true, error: null };
  if (regex) {
    let re: RegExp;
    try {
      re = new RegExp(q, "i");
    } catch (e) {
      return { test: () => false, error: e instanceof Error ? e.message : String(e) };
    }
    return { test: (o) => re.test(o.label) || re.test(o.key), error: null };
  }
  const needle = q.toLowerCase();
  return {
    test: (o) => o.label.toLowerCase().includes(needle) || o.key.toLowerCase().includes(needle),
    error: null,
  };
}

export interface FilteredFields {
  /** Matches, grouped by kind in `FIELD_KIND_ORDER`, each group in input order. */
  groups: Array<{ kind: FieldKind; options: FieldOption[] }>;
  /** All matches flattened in group order. */
  matches: FieldOption[];
  error: string | null;
}

/** Filter `options` by `query`, leaving out the keys in `exclude`. */
export function filterFields(
  options: readonly FieldOption[],
  query: string,
  regex: boolean,
  exclude: ReadonlySet<string> = new Set(),
): FilteredFields {
  const m = fieldMatcher(query, regex);
  const groups = FIELD_KIND_ORDER.map((kind) => ({
    kind,
    options: options.filter((o) => o.kind === kind && !exclude.has(o.key) && m.test(o)),
  })).filter((g) => g.options.length > 0);
  return { groups, matches: groups.flatMap((g) => g.options), error: m.error };
}

/** `value` plus every match not already in it, in order, without duplicates. */
export function addAll(value: readonly string[], matches: readonly FieldOption[]): string[] {
  const out = [...value];
  const seen = new Set(value);
  for (const o of matches) {
    if (seen.has(o.key)) continue;
    seen.add(o.key);
    out.push(o.key);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tabs (SettingsTabs)

export type SettingsTabId = "data" | "grouping" | "display" | "expressions";

/** The fixed tab order. */
export const SETTINGS_TABS: ReadonlyArray<{ id: SettingsTabId; label: string }> = [
  { id: "data", label: "Data" },
  { id: "grouping", label: "Grouping" },
  { id: "display", label: "Display" },
  { id: "expressions", label: "Expressions" },
];

/** The tabs with content, in the fixed order. */
export function visibleTabs(hasContent: Partial<Record<SettingsTabId, boolean>>): SettingsTabId[] {
  return SETTINGS_TABS.map((t) => t.id).filter((id) => hasContent[id]);
}

/** The tab bar shows only when more than one tab has content. */
export function showTabBar(visible: readonly SettingsTabId[]): boolean {
  return visible.length > 1;
}

/** `requested` when it is visible, else the first visible tab (null when none). */
export function activeTab(
  requested: SettingsTabId | null | undefined,
  visible: readonly SettingsTabId[],
): SettingsTabId | null {
  if (requested && visible.includes(requested)) return requested;
  return visible[0] ?? null;
}

// ---------------------------------------------------------------------------
// Sections (SettingsSection)

/** The shared section names; every card's panel picks its sections from here. */
export const SECTION_NAMES = [
  "Axes",
  "Smoothing",
  "Outliers",
  "Series",
  "Appearance",
  "Overlays",
  "Layout",
  "Playback",
  "Compare",
] as const;

export type SectionName = (typeof SECTION_NAMES)[number];

/** sessionStorage key of a section's open/closed state (shared by every card). */
export function sectionStorageKey(name: SectionName): string {
  return `cairn:settings-section:${name}`;
}

/** Stored flag → open. Missing or unreadable → `fallback`. */
export function parseSectionOpen(raw: string | null, fallback: boolean): boolean {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return fallback;
}

// ---------------------------------------------------------------------------
// Numbers (NumberInput / Stepper / SliderInput / RangeInput)

export interface NumberBounds {
  min?: number;
  max?: number;
  integer?: boolean;
}

export type NumberDraft =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

/**
 * Parse a number box's text. Empty → `null` ("auto") when `nullable`, an
 * error otherwise. Accepts anything `Number()` does (1e-3, .5, -2) except
 * non-finite values.
 */
export function parseNumberDraft(raw: string, bounds: NumberBounds = {}, nullable = true): NumberDraft {
  const s = raw.trim();
  if (s === "") return nullable ? { ok: true, value: null } : { ok: false, error: "Required" };
  const n = Number(s);
  if (!Number.isFinite(n)) return { ok: false, error: "Not a number" };
  if (bounds.integer && !Number.isInteger(n)) return { ok: false, error: "Must be a whole number" };
  if (bounds.min != null && n < bounds.min) return { ok: false, error: `At least ${bounds.min}` };
  if (bounds.max != null && n > bounds.max) return { ok: false, error: `At most ${bounds.max}` };
  return { ok: true, value: n };
}

export function clamp(v: number, min?: number, max?: number): number {
  if (min != null && v < min) return min;
  if (max != null && v > max) return max;
  return v;
}

/** Decimal places of `step` (0.05 → 2, 1e-3 → 3, 1 → 0). */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || Number.isInteger(step)) return 0;
  const s = String(step);
  const exp = s.match(/e-(\d+)$/);
  if (exp) return Number(exp[1]);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** `v + delta·step`, clamped, rounded to the step's precision (no 0.30000000000000004). */
export function stepValue(v: number, delta: number, step = 1, min?: number, max?: number): number {
  const d = stepDecimals(step);
  return clamp(Number((v + delta * step).toFixed(d)), min, max);
}

export interface RangeValue {
  min: number | null;
  max: number | null;
  log: boolean;
}

/** Why a range is invalid, or null. `null` bounds are "auto" and always fine. */
export function rangeError(r: RangeValue): string | null {
  if (r.min != null && r.max != null && r.min >= r.max) return "Min must be below max";
  if (r.log && ((r.min != null && r.min <= 0) || (r.max != null && r.max <= 0))) {
    return "Log scale needs positive bounds";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Colormaps (ColormapSelect)

/** Plotly's built-in scales, which `colorscale()` names instead of listing stops. */
const NAMED_STOPS: Record<string, string[]> = {
  Viridis: ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"],
  Greys: ["#000000", "#ffffff"],
};

/** A left-to-right CSS gradient of a colormap, for swatches. */
export function colormapGradient(name: Colormap): string {
  const scale = colorscale(name);
  const stops =
    typeof scale === "string"
      ? (NAMED_STOPS[scale] ?? ["#000000", "#ffffff"]).map(
          (c, i, a) => `${c} ${((i / (a.length - 1)) * 100).toFixed(1)}%`,
        )
      : scale.map(([t, c]) => `${c} ${(t * 100).toFixed(1)}%`);
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
