/**
 * Custom viewers: turn a viewer folder's files into what its sandboxed frame
 * loads (pure; tested in bundle.test.ts).
 *
 * The frame has an opaque origin and no network (CSP `connect-src 'none'`,
 * scripts only from `blob:`), so every module reaches it as text and becomes
 * a blob URL inside the frame (a blob URL made by the host would not load
 * there: another origin). Blob URLs are not hierarchical, so a module loaded
 * from one cannot resolve `./dep.js` (Chrome rejects it before consulting an
 * import map). So, here:
 *
 * - every relative (`./x.js`, `../x.js`) and folder-absolute (`/x.js`)
 *   specifier in a module's static imports, re-exports and `import()` calls
 *   is rewritten to a virtual absolute one, `cairn-viewer:/<path in the
 *   folder>`;
 * - the import map then maps each virtual specifier, each manifest
 *   `imports` entry (a bare name, or a `"name/"` folder prefix expanded file
 *   by file) and the host-provided `cairn:sdk` / `cairn:three` (and `three`,
 *   unless the viewer vendors its own) to a file path, which the frame
 *   replaces with that file's blob URL.
 *
 * Known limits: `new URL("./x.png", import.meta.url)` cannot resolve against
 * a blob; viewers load assets through the SDK's `asset(path)`.
 */

import { normalizePath, type ViewerManifest } from "./manifest.ts";

/** The virtual scheme of the viewer folder's files. */
export const VIRTUAL = "cairn-viewer:/";
/** Where host-provided modules live in the virtual folder (a viewer may not use it). */
export const PROVIDED_DIR = "__cairn/";

/** One file of a viewer folder, as fetched. */
export interface SourceFile {
  /** Folder-relative path, `/`-separated. */
  path: string;
  data: Uint8Array | ArrayBuffer | string;
}

/** A module the host provides under a `cairn:` specifier (the SDK, three.js). */
export interface ProvidedModule {
  specifier: string;
  /** More specifiers resolving to the same module (`three` for `cairn:three`), unless the viewer maps them itself. */
  aliases?: string[];
  /** The module the specifier resolves to, a path under `__cairn/`. */
  entry: string;
  /** Its files (their imports already virtual). */
  files: SourceFile[];
}

/** One file as the frame gets it: modules as text, the rest as bytes. */
export interface BundleFile {
  path: string;
  mime: string;
  data: string | ArrayBuffer;
}

export interface ViewerBundle {
  files: BundleFile[];
  /** Import map: specifier → file path (the frame swaps in blob URLs). */
  imports: Record<string, string>;
  /** The specifier the frame imports to start the viewer. */
  entry: string;
  /** Imports that name no file (shown in the console; the import fails in the frame). */
  warnings: string[];
}

const MIME: Record<string, string> = {
  js: "text/javascript", mjs: "text/javascript", cjs: "text/javascript",
  json: "application/json", css: "text/css", wasm: "application/wasm",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  txt: "text/plain", html: "text/html", glsl: "text/plain", frag: "text/plain", vert: "text/plain", bin: "application/octet-stream",
};

export function mimeOf(path: string): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

export const isModulePath = (path: string): boolean => /\.(m?js|cjs)$/i.test(path);

/**
 * Static `import … from "x"`, `export … from "x"`, `import "x"` and dynamic
 * `import("x")`: group 1 the prefix, 2 the quote, 3 the specifier.
 */
const IMPORT_RE = /(\bfrom\s*|\bimport\s*|\bimport\s*\(\s*)(["'])([^"'\n\r]+)\2/g;

/** Whether a specifier is relative to the importing module (`./`, `../`, `/`; not `//host`). */
export const isRelativeSpecifier = (spec: string): boolean => /^(\.{1,2}\/|\/(?!\/))/.test(spec);

/** The relative specifiers a module imports (unique, in order). */
export function relativeSpecifiers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[3]!;
    if (isRelativeSpecifier(spec) && !out.includes(spec)) out.push(spec);
  }
  return out;
}

/** Replace each relative specifier with `map(spec)` (kept when it returns null). */
export function rewriteSpecifiers(text: string, map: (spec: string) => string | null): string {
  return text.replace(IMPORT_RE, (all, prefix: string, q: string, spec: string) => {
    if (!isRelativeSpecifier(spec)) return all;
    const next = map(spec);
    return next == null ? all : `${prefix}${q}${next}${q}`;
  });
}

/** A specifier relative to the module at `fromPath`, as a folder path (null when it leaves the folder). */
export function resolveIn(fromPath: string, spec: string): string | null {
  if (spec.startsWith("/")) return normalizePath(spec);
  const dir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/") + 1) : "";
  return normalizePath(dir + spec.replace(/[?#].*$/, ""));
}

const decoder = new TextDecoder();
const asText = (d: SourceFile["data"]): string => (typeof d === "string" ? d : decoder.decode(d));
function asBuffer(d: SourceFile["data"]): ArrayBuffer {
  if (typeof d === "string") return new TextEncoder().encode(d).buffer as ArrayBuffer;
  if (d instanceof ArrayBuffer) return d;
  return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer;
}

/**
 * The bundle the frame loads: the viewer's files (modules rewritten), the
 * provided modules, and the import map. Throws when the entry is missing or
 * a file claims the provided folder.
 */
export function buildViewerBundle(
  manifest: Pick<ViewerManifest, "entry" | "imports">,
  files: readonly SourceFile[],
  provided: readonly ProvidedModule[] = [],
): ViewerBundle {
  const warnings: string[] = [];
  const byPath = new Map<string, SourceFile>();
  for (const f of files) {
    const p = normalizePath(f.path);
    if (p == null || p === "") continue;
    if (p.startsWith(PROVIDED_DIR)) throw new Error(`${p}: the folder "${PROVIDED_DIR}" is cairn's`);
    byPath.set(p, f);
  }
  if (!byPath.has(manifest.entry)) throw new Error(`the entry "${manifest.entry}" is not in the viewer`);

  const out: BundleFile[] = [];
  const imports: Record<string, string> = {};
  const addModule = (path: string, text: string) => {
    out.push({ path, mime: "text/javascript", data: text });
    imports[VIRTUAL + path] = path;
  };
  for (const [path, f] of byPath) {
    if (!isModulePath(path)) {
      // JSON / CSS modules (`import x from "./x.json" with {type: "json"}`) resolve too.
      out.push({ path, mime: mimeOf(path), data: asBuffer(f.data) });
      imports[VIRTUAL + path] = path;
      continue;
    }
    const text = rewriteSpecifiers(asText(f.data), (spec) => {
      const target = resolveIn(path, spec);
      if (target == null || !byPath.has(target)) {
        warnings.push(`${path} imports "${spec}", which is not in the viewer`);
        return null;
      }
      return VIRTUAL + target;
    });
    addModule(path, text);
  }

  // The viewer's bare specifiers; a folder prefix maps every file under it.
  for (const [spec, target] of Object.entries(manifest.imports)) {
    if (spec.endsWith("/")) {
      let any = false;
      for (const path of byPath.keys()) {
        if (!path.startsWith(target)) continue;
        imports[spec + path.slice(target.length)] = path;
        any = true;
      }
      if (!any) warnings.push(`imports["${spec}"]: no files under "${target}"`);
    } else if (byPath.has(target)) imports[spec] = target;
    else warnings.push(`imports["${spec}"]: "${target}" is not in the viewer`);
  }

  for (const mod of provided) {
    for (const f of mod.files) addModule(f.path, asText(f.data));
    imports[mod.specifier] = mod.entry;
    for (const alias of mod.aliases ?? []) if (!(alias in imports)) imports[alias] = mod.entry;
  }
  return { files: out, imports, entry: VIRTUAL + manifest.entry, warnings };
}
