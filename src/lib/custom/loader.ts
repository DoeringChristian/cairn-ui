/**
 * Custom viewers: fetching a viewer's files (with the user's session — the
 * frame cannot) and building the bundle its frame loads (bundle.ts).
 *
 * Bundles are cached per viewer version (a dev source: per revision) for the
 * page, so ten cards of one viewer fetch its files once; each frame then
 * makes its own blob URLs (an opaque-origin frame cannot load another
 * origin's blob URLs) and revokes them when it goes away. Files are fetched
 * in parallel (8 at a time); published versions' files are immutable and hit
 * the HTTP cache on later page loads.
 */

import { api } from "../../api/client";
import { buildViewerBundle, isModulePath, type ProvidedModule, type SourceFile, type ViewerBundle } from "./bundle.ts";
import type { ViewerManifest } from "./manifest.ts";
import type { Viewer } from "./viewers.ts";

export type { Viewer } from "./viewers.ts";
import { SDK_SOURCE } from "./sdk-runtime.ts";
import { threePackage } from "./three-package.ts";

const SDK: ProvidedModule = {
  specifier: "cairn:sdk",
  entry: "__cairn/sdk.js",
  files: [{ path: "__cairn/sdk.js", data: SDK_SOURCE }],
};

/** Whether a module text uses three without vendoring it. */
function usesHostThree(modules: SourceFile[], manifest: ViewerManifest): boolean {
  if ("three" in manifest.imports) {
    return modules.some((f) => typeof f.data === "string" && f.data.includes("cairn:three"));
  }
  const decoder = new TextDecoder();
  return modules.some((f) => {
    const t = typeof f.data === "string" ? f.data : decoder.decode(f.data);
    return /["']cairn:three["']|["']three["']/.test(t);
  });
}

async function pool<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function fetchFiles(project: string, viewer: Viewer): Promise<SourceFile[]> {
  const { info } = viewer;
  if (info.dev) {
    const list = await api.viewerDevFiles(project, info.name);
    return pool(list.files, 8, async (f) => ({ path: f.path, data: await api.viewerDevFile(project, info.name, f.path) }));
  }
  if (!info.version_id) throw new Error(`viewer ${info.name} has no published version`);
  const list = await api.artifactVersionFiles(info.version_id);
  const files = list.files.filter((f) => f.digest != null);
  return pool(files, 8, async (f) => ({ path: f.path, data: await api.artifactVersionFileBytes(info.version_id!, f.path) }));
}

async function build(project: string, viewer: Viewer): Promise<ViewerBundle> {
  const manifest = viewer.manifest!;
  const files = await fetchFiles(project, viewer);
  const modules = files.filter((f) => isModulePath(f.path));
  const provided: ProvidedModule[] = [SDK];
  if (usesHostThree(modules, manifest)) provided.push(await threePackage());
  const bundle = buildViewerBundle(manifest, files, provided);
  for (const w of bundle.warnings) console.warn(`viewer ${manifest.name}: ${w}`);
  return bundle;
}

const MAX_CACHED = 12;
const cache = new Map<string, Promise<ViewerBundle>>();

/** The bundle of a viewer, fetched once per version (dev: per revision) for the page. */
export function loadViewerBundle(project: string, viewer: Viewer): Promise<ViewerBundle> {
  if (!viewer.manifest) return Promise.reject(new Error(viewer.error ?? "invalid viewer"));
  const key = `${project}|${viewer.key}`;
  let p = cache.get(key);
  if (p) {
    // Most recently used last.
    cache.delete(key);
    cache.set(key, p);
    return p;
  }
  p = build(project, viewer);
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return p;
}
