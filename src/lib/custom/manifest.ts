/**
 * Custom viewers: the `cairn-viewer.json` manifest and which series a viewer
 * accepts (pure; tested in manifest.test.ts).
 *
 * A viewer is a folder (`cairn-viewer.json` + `index.js` + any modules and
 * vendored libraries) published as a `cairn-viewer` artifact. The manifest:
 *
 * ```json
 * { "name": "vmf-sphere", "title": "Guiding distribution",
 *   "accepts": ["custom:guiding/*"], "inputs": "single" | "compare",
 *   "webgl": true, "view": true, "entry": "index.js",
 *   "imports": {"d3": "./vendor/d3.js", "three/addons/": "./vendor/three-addons/"},
 *   "settings": [{"key": "exposure", "type": "slider", "min": 0, "max": 4, "default": 1}] }
 * ```
 *
 * Unknown fields are ignored (a newer manifest still loads); a field of the
 * wrong shape is an error naming it.
 */

/** Icons a viewer may name (Font Awesome solid; the server's list, cairn/server/viewer_manifest.py). */
export const VIEWER_ICONS = [
  "cube", "cubes", "globe", "sun", "fire", "eye", "compass", "brain", "image", "images",
  "chart-line", "chart-area", "chart-column", "wave-square", "table", "table-cells", "shapes",
  "layer-group", "circle-nodes", "diagram-project", "route", "microscope", "atom", "wand-magic-sparkles",
] as const;

/** The settings tabs and sections a setting can sit in (the settings palette's). */
export const SETTING_TABS = ["values", "grouping", "display", "expressions"] as const;
export const SETTING_SECTIONS = ["Axes", "Smoothing", "Outliers", "Series", "Appearance", "Overlays", "Layout", "Playback", "Compare"] as const;
export type ViewerSettingTab = (typeof SETTING_TABS)[number];
export type ViewerSettingSection = (typeof SETTING_SECTIONS)[number];

/** The palette controls a manifest setting can use. */
export const SETTING_TYPES = ["slider", "number", "select", "switch", "colormap", "text"] as const;
export type ViewerSettingType = (typeof SETTING_TYPES)[number];

export interface ViewerSetting {
  key: string;
  type: ViewerSettingType;
  label: string;
  /** Help text under the control. */
  help?: string;
  /** Where the control sits in the card's settings. */
  tab: ViewerSettingTab;
  section: ViewerSettingSection;
  default: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  /** `select`: the choices; `colormap`: the colormaps offered (all when absent). */
  options?: Array<{ value: string; label: string }>;
  /** `text`: shown while empty. */
  placeholder?: string;
}

export interface ViewerManifest {
  name: string;
  title: string;
  description?: string;
  /** Font Awesome solid icon name (one of VIEWER_ICONS). */
  icon?: string;
  /** Patterns of the series it shows: `custom:<kind glob>` or a built-in object type (`volume`). */
  accepts: string[];
  /** `compare`: the viewer gets the pane's input and its reference together, as [A, B]. */
  inputs: "single" | "compare";
  /** It draws with WebGL: each frame counts against the page's context budget. */
  webgl: boolean;
  /** It has a view state (a camera) the card syncs across its panes. */
  view: boolean;
  /** The module the frame imports first, relative to the folder. */
  entry: string;
  /** Bare specifiers → vendored files (`"d3": "./vendor/d3.js"`) or folders (`"x/": "./vendor/x/"`). */
  imports: Record<string, string>;
  settings: ViewerSetting[];
}

export type ManifestResult = { ok: true; manifest: ViewerManifest } | { ok: false; errors: string[] };

const NAME_RE = /^[a-z0-9][a-z0-9_.-]*$/;
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Keys a viewer setting may not use (the card's own; see the contract). */
const RESERVED_KEYS = new Set(["viewer", "viewer_version"]);

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);
/** The object without its null-valued fields (a normalized manifest writes `null` for "none"). */
const dropNulls = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null));

/** Normalise a folder-relative path (`./a/../b.js` → `b.js`); null when it leaves the folder. */
export function normalizePath(path: string): string | null {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

/** Parse and validate a manifest (a JSON string or the parsed value). */
export function parseManifest(input: unknown): ManifestResult {
  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch (e) {
      return { ok: false, errors: [`cairn-viewer.json is not JSON: ${(e as Error).message}`] };
    }
  }
  if (!isObj(parsed)) return { ok: false, errors: ["cairn-viewer.json must be an object"] };
  const raw = dropNulls(parsed);
  const errors: string[] = [];
  const str = (k: string, required: boolean): string | undefined => {
    const v = raw[k];
    if (v === undefined) {
      if (required) errors.push(`"${k}" is required`);
      return undefined;
    }
    if (typeof v !== "string" || !v.trim()) {
      errors.push(`"${k}" must be a non-empty string`);
      return undefined;
    }
    return v;
  };
  const bool = (k: string, dflt: boolean): boolean => {
    const v = raw[k];
    if (v === undefined) return dflt;
    if (typeof v !== "boolean") errors.push(`"${k}" must be true or false`);
    return v === true;
  };

  const name = str("name", true);
  if (name && (!NAME_RE.test(name) || name.length > 64)) errors.push(`"name" must match ${NAME_RE.source} (at most 64 characters)`);
  const title = str("title", false) ?? name ?? "";
  const description = str("description", false);
  const icon = str("icon", false);
  if (icon && !(VIEWER_ICONS as readonly string[]).includes(icon)) errors.push(`"icon" must be one of ${VIEWER_ICONS.join(", ")}`);

  let accepts: string[] = [];
  if (!Array.isArray(raw.accepts) || raw.accepts.length === 0 || !raw.accepts.every((a) => typeof a === "string" && a.trim())) {
    errors.push(`"accepts" must be a non-empty list of patterns (e.g. "custom:guiding/*", "volume")`);
  } else accepts = raw.accepts.map((a: string) => a.trim());

  let inputs: "single" | "compare" = "single";
  if (raw.inputs !== undefined) {
    if (raw.inputs === "single" || raw.inputs === "compare") inputs = raw.inputs;
    else errors.push(`"inputs" must be "single" or "compare"`);
  }

  const entryRaw = str("entry", false) ?? "index.js";
  const entry = normalizePath(entryRaw);
  if (entry == null || entry === "") errors.push(`"entry" must be a path inside the viewer folder`);

  const imports: Record<string, string> = {};
  if (raw.imports !== undefined) {
    if (!isObj(raw.imports)) errors.push(`"imports" must map specifiers to paths`);
    else {
      for (const [spec, target] of Object.entries(raw.imports)) {
        if (typeof target !== "string") {
          errors.push(`imports["${spec}"] must be a path`);
          continue;
        }
        if (spec.startsWith("cairn:")) {
          errors.push(`imports["${spec}"]: "cairn:" specifiers are provided by cairn`);
          continue;
        }
        if (!spec || /^[./]/.test(spec) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(spec)) {
          errors.push(`imports["${spec}"]: keys are bare specifiers ("d3", "three/addons/")`);
          continue;
        }
        if (!target.startsWith("./")) {
          errors.push(`imports["${spec}"] must be a "./" path into the folder ("./vendor/…"); the viewer has no network`);
          continue;
        }
        const norm = normalizePath(target);
        if (norm == null || target.split("/").includes("..")) {
          errors.push(`imports["${spec}"] leaves the viewer folder`);
          continue;
        }
        if (spec.endsWith("/") !== target.endsWith("/")) {
          errors.push(`imports["${spec}"]: a folder mapping ends both sides with "/"`);
          continue;
        }
        imports[spec] = spec.endsWith("/") ? `${norm}/` : norm;
      }
    }
  }

  const settings: ViewerSetting[] = [];
  if (raw.settings !== undefined) {
    if (!Array.isArray(raw.settings)) errors.push(`"settings" must be a list`);
    else {
      const seen = new Set<string>();
      raw.settings.forEach((s, i) => {
        const r = parseSetting(s, i);
        if (typeof r === "string") errors.push(r);
        else if (seen.has(r.key)) errors.push(`settings[${i}]: duplicate key "${r.key}"`);
        else {
          seen.add(r.key);
          settings.push(r);
        }
      });
    }
  }

  const webgl = bool("webgl", false);
  const view = bool("view", false);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    manifest: {
      name: name!, title, ...(description ? { description } : {}), ...(icon ? { icon } : {}), accepts, inputs, webgl, view,
      entry: entry!, imports, settings,
    },
  };
}

function parseSetting(setting: unknown, i: number): ViewerSetting | string {
  const at = `settings[${i}]`;
  if (!isObj(setting)) return `${at} must be an object`;
  const s = dropNulls(setting);
  const key = s.key;
  if (typeof key !== "string" || !KEY_RE.test(key)) return `${at}: "key" must be an identifier`;
  if (RESERVED_KEYS.has(key)) return `${at}: "${key}" is a card setting; pick another key`;
  const type = s.type;
  if (typeof type !== "string" || !(SETTING_TYPES as readonly string[]).includes(type)) {
    return `${at} (${key}): "type" must be one of ${SETTING_TYPES.join(", ")}`;
  }
  const num = (k: string): number | undefined | string => {
    const v = s[k];
    if (v === undefined) return undefined;
    return typeof v === "number" && Number.isFinite(v) ? v : `${at} (${key}): "${k}" must be a number`;
  };
  const min = num("min");
  const max = num("max");
  const step = num("step");
  for (const v of [min, max, step]) if (typeof v === "string") return v;
  const label = typeof s.label === "string" && s.label ? s.label : key;
  if (s.help !== undefined && typeof s.help !== "string") return `${at} (${key}): "help" must be a string`;
  const tab = s.tab ?? "display";
  if (!(SETTING_TABS as readonly unknown[]).includes(tab)) return `${at} (${key}): "tab" must be one of ${SETTING_TABS.join(", ")}`;
  const section = s.section ?? "Appearance";
  if (!(SETTING_SECTIONS as readonly unknown[]).includes(section)) return `${at} (${key}): "section" must be one of ${SETTING_SECTIONS.join(", ")}`;
  const out: ViewerSetting = {
    key, type: type as ViewerSettingType, label, tab: tab as ViewerSettingTab, section: section as ViewerSettingSection, default: 0,
  };
  if (typeof s.help === "string" && s.help) out.help = s.help;
  if (min !== undefined) out.min = min as number;
  if (max !== undefined) out.max = max as number;
  if (step !== undefined) out.step = step as number;
  const d = s.default;
  switch (type) {
    case "slider":
    case "number": {
      if (type === "slider" && (out.min === undefined || out.max === undefined)) return `${at} (${key}): a slider needs "min" and "max"`;
      if (out.min !== undefined && out.max !== undefined && out.min > out.max) return `${at} (${key}): "min" is above "max"`;
      if (d !== undefined && (typeof d !== "number" || !Number.isFinite(d))) return `${at} (${key}): "default" must be a number`;
      out.default = typeof d === "number" ? d : (out.min ?? 0);
      break;
    }
    case "switch":
      if (d !== undefined && typeof d !== "boolean") return `${at} (${key}): "default" must be true or false`;
      out.default = d === true;
      break;
    case "select": {
      if (!Array.isArray(s.options) || s.options.length === 0) return `${at} (${key}): a select needs "options"`;
      const options: Array<{ value: string; label: string }> = [];
      for (const o of s.options) {
        if (typeof o === "string") options.push({ value: o, label: o });
        else if (isObj(o) && typeof o.value === "string") options.push({ value: o.value, label: typeof o.label === "string" ? o.label : o.value });
        else return `${at} (${key}): options are strings or {value, label}`;
      }
      out.options = options;
      if (d !== undefined && !options.some((o) => o.value === d)) return `${at} (${key}): "default" is not one of the options`;
      out.default = typeof d === "string" ? d : options[0]!.value;
      break;
    }
    case "colormap": {
      if (d !== undefined && typeof d !== "string") return `${at} (${key}): "default" must be a string`;
      if (s.options !== undefined) {
        if (!Array.isArray(s.options) || !s.options.length || !s.options.every((o) => typeof o === "string")) {
          return `${at} (${key}): colormap "options" are colormap names`;
        }
        out.options = (s.options as string[]).map((o) => ({ value: o, label: o }));
      }
      out.default = typeof d === "string" ? d : (out.options?.[0]?.value ?? "turbo");
      break;
    }
    case "text":
      if (d !== undefined && typeof d !== "string") return `${at} (${key}): "default" must be a string`;
      if (typeof s.placeholder === "string") out.placeholder = s.placeholder;
      out.default = typeof d === "string" ? d : "";
      break;
  }
  return out;
}

/**
 * Where a card stores a viewer setting: the flat key `vs:<viewer>:<key>`,
 * so section/workspace defaults cascade per viewer and per setting.
 */
export function viewerSettingKey(viewer: string, key: string): string {
  return `vs:${viewer}:${key}`;
}

/** The cascade pattern of every viewer setting (see lib/settings-cascade.ts). */
export const VIEWER_SETTINGS_CASCADE = "vs:*";

/** A viewer's stored setting values out of a card's settings (keys without the prefix). */
export function storedViewerSettings(cardSettings: Record<string, unknown>, viewer: string): Record<string, unknown> {
  const prefix = `vs:${viewer}:`;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cardSettings)) if (k.startsWith(prefix) && v !== undefined) out[k.slice(prefix.length)] = v;
  return out;
}

/**
 * A viewer's own settings change (`setSettings(patch)` from its frame),
 * checked against the manifest: unknown keys and values of the wrong type
 * (or not among a select's options) are rejected; numbers are clamped to
 * [min, max]; text is cut at 1000 characters.
 */
export function validateSettingsPatch(
  settings: readonly ViewerSetting[],
  patch: Record<string, unknown>,
): { accepted: Record<string, string | number | boolean>; rejected: string[] } {
  const accepted: Record<string, string | number | boolean> = {};
  const rejected: string[] = [];
  const byKey = new Map(settings.map((s) => [s.key, s]));
  for (const [k, v] of Object.entries(patch)) {
    const s = byKey.get(k);
    if (!s) {
      rejected.push(`${k}: not a setting of this viewer`);
      continue;
    }
    if (typeof v !== typeof s.default || (typeof v === "number" && !Number.isFinite(v))) {
      rejected.push(`${k}: expected a ${typeof s.default}`);
      continue;
    }
    if ((s.type === "select" || (s.type === "colormap" && s.options)) && !s.options!.some((o) => o.value === v)) {
      rejected.push(`${k}: ${JSON.stringify(v)} is not an option`);
      continue;
    }
    if (typeof v === "number") accepted[k] = Math.min(s.max ?? Infinity, Math.max(s.min ?? -Infinity, v));
    else if (typeof v === "string") accepted[k] = v.slice(0, 1000);
    else accepted[k] = v as boolean;
  }
  return { accepted, rejected };
}

/** The manifest settings' defaults, by key. */
export function settingDefaults(settings: readonly ViewerSetting[]): Record<string, string | number | boolean> {
  return Object.fromEntries(settings.map((s) => [s.key, s.default]));
}

/**
 * The manifest settings' effective values: the stored ones where they still
 * fit the setting (right type, a select option that still exists), else the
 * default. Values of keys the manifest no longer has are dropped.
 */
export function settingValues(
  settings: readonly ViewerSetting[],
  stored: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const s of settings) {
    const v = stored?.[s.key];
    let ok = typeof v === typeof s.default;
    if (ok && s.type === "select") ok = s.options!.some((o) => o.value === v);
    if (ok && typeof v === "number" && !Number.isFinite(v)) ok = false;
    out[s.key] = ok ? (v as string | number | boolean) : s.default;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Accepts
// ---------------------------------------------------------------------------

/** What a series is, for matching: its object type, and a custom series' kind. */
export interface SeriesKind {
  object_type: string;
  kind?: string | null;
}

/** A glob: `*` matches any run of characters (`/` included), `?` one character; the rest is literal. */
function globRegex(glob: string): RegExp {
  let re = "";
  for (const c of glob) re += c === "*" ? ".*" : c === "?" ? "." : c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${re}$`, "s");
}

/** The string `accepts` patterns match: `custom:<kind>` for custom data, else the object type. */
export function acceptSubject(series: SeriesKind): string {
  return series.object_type === "custom" ? `custom:${series.kind ?? ""}` : series.object_type;
}

/**
 * Whether one `accepts` pattern matches a series (whole string): custom
 * data is matched as `custom:<kind>` (`custom:guiding/*` takes
 * `guiding/vmf` and `guiding/a/b`), a built-in series by its object type
 * (`volume`).
 */
export function acceptMatches(pattern: string, series: SeriesKind): boolean {
  return globRegex(pattern).test(acceptSubject(series));
}

/** Whether a viewer accepts a series. */
export function accepts(manifest: Pick<ViewerManifest, "accepts">, series: SeriesKind): boolean {
  return manifest.accepts.some((p) => acceptMatches(p, series));
}

/**
 * How specific the best pattern matching a series is (higher is more
 * specific; -1 when none matches): an exact kind beats a glob, a glob beats
 * a bare object type. Picks the default viewer among several.
 */
export function acceptScore(manifest: Pick<ViewerManifest, "accepts">, series: SeriesKind): number {
  let best = -1;
  for (const p of manifest.accepts) {
    if (!acceptMatches(p, series)) continue;
    // No wildcard beats a wildcard; among globs, more literal characters win.
    const literal = p.replace(/[*?]/g, "").length;
    const score = /[*?]/.test(p) ? literal / 1000 : 1 + literal / 1000;
    best = Math.max(best, score);
  }
  return best;
}
