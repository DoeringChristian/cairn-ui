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

/** The palette controls a manifest setting can use. */
export const SETTING_TYPES = ["slider", "number", "select", "switch", "colormap", "text"] as const;
export type ViewerSettingType = (typeof SETTING_TYPES)[number];

export interface ViewerSetting {
  key: string;
  type: ViewerSettingType;
  label: string;
  description?: string;
  default: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  /** `select`: the choices (a value, or `{value, label}`). */
  options?: Array<{ value: string; label: string }>;
}

export interface ViewerManifest {
  name: string;
  title: string;
  description?: string;
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
/** Settings keys the card itself owns; a viewer setting may not shadow them. */
const RESERVED_KEYS = new Set([
  "version", "metrics", "title", "height", "colSpan", "collapsed", "viewer", "viewerVersion", "viewerSettings", "view",
  "sliderStep", "sliderKey", "followSection", "columns", "maxRuns", "panelMode", "compareSlots", "compareLinked",
  "paneWidths", "xAxis", "reference", "referenceStep",
]);

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

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
  let raw: unknown = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      return { ok: false, errors: [`cairn-viewer.json is not JSON: ${(e as Error).message}`] };
    }
  }
  if (!isObj(raw)) return { ok: false, errors: ["cairn-viewer.json must be an object"] };
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
  if (name && !NAME_RE.test(name)) errors.push(`"name" must match ${NAME_RE.source}`);
  const title = str("title", false) ?? name ?? "";
  const description = str("description", false);

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
        if (!/^\.{0,2}\//.test(target)) {
          errors.push(`imports["${spec}"] must be a relative path into the folder ("./vendor/…"); the viewer has no network`);
          continue;
        }
        const norm = normalizePath(target);
        if (norm == null) {
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
      name: name!, title, ...(description ? { description } : {}), accepts, inputs, webgl, view,
      entry: entry!, imports, settings,
    },
  };
}

function parseSetting(s: unknown, i: number): ViewerSetting | string {
  const at = `settings[${i}]`;
  if (!isObj(s)) return `${at} must be an object`;
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
  const description = typeof s.description === "string" ? s.description : undefined;
  const out: ViewerSetting = { key, type: type as ViewerSettingType, label, default: 0 };
  if (description) out.description = description;
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
    case "colormap":
    case "text":
      if (d !== undefined && typeof d !== "string") return `${at} (${key}): "default" must be a string`;
      out.default = typeof d === "string" ? d : type === "colormap" ? "viridis" : "";
      break;
  }
  return out;
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

/** A glob over a kind: `*` matches any run of characters within a segment, `**` across segments. */
function globRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else re += "[^/]*";
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/**
 * Whether one `accepts` pattern matches a series:
 * - `custom:<glob>` matches custom data whose kind matches the glob
 *   (`custom:guiding/*` → `guiding/vmf`; `custom:**` → every kind);
 * - anything else is an object type glob (`volume`, `custom` = all custom data).
 */
export function acceptMatches(pattern: string, series: SeriesKind): boolean {
  const colon = pattern.indexOf(":");
  if (colon >= 0) {
    const type = pattern.slice(0, colon);
    if (!globRegex(type).test(series.object_type)) return false;
    return series.kind != null && globRegex(pattern.slice(colon + 1)).test(series.kind);
  }
  return globRegex(pattern).test(series.object_type);
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
    const score = p.includes(":") ? (p.includes("*") ? 2 + p.replace(/\*/g, "").length / 1000 : 3) : p.includes("*") ? 0 : 1;
    best = Math.max(best, score);
  }
  return best;
}
