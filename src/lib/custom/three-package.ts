/**
 * `cairn:three`: the app's own three.js chunk(s), read back as text and
 * handed to viewer frames as a provided module (see bundle.ts).
 *
 * The module three-ns.ts is imported (so its chunk and the shared three
 * chunk are in the browser's cache already, or get there once), then its
 * text and every chunk it imports are fetched (cache hits) and their
 * relative imports rewritten to virtual `cairn-viewer:/__cairn/three/…`
 * paths. Done once per page; every frame gets the same texts.
 */

import { PROVIDED_DIR, VIRTUAL, isRelativeSpecifier, rewriteSpecifiers, relativeSpecifiers, type ProvidedModule, type SourceFile } from "./bundle.ts";

/** The three.js revision viewers get (documented for viewer authors). */
export { REVISION as THREE_REVISION } from "three";

let pkg: Promise<ProvidedModule> | null = null;

export function threePackage(): Promise<ProvidedModule> {
  pkg ??= load().catch((e) => {
    pkg = null;
    throw e;
  });
  return pkg;
}

async function load(): Promise<ProvidedModule> {
  const ns = await import("./three-ns.ts");
  const root = new URL(ns.__cairnChunkUrl, location.href);
  const dir = `${PROVIDED_DIR}three/`;
  const pathOf = new Map<string, string>();
  const files: SourceFile[] = [];
  const queue: URL[] = [root];
  pathOf.set(root.href, `${dir}0.js`);
  while (queue.length) {
    const batch = queue.splice(0);
    const texts = await Promise.all(batch.map(async (u) => {
      const res = await fetch(u.href);
      if (!res.ok) throw new Error(`cairn:three: ${u.pathname}: HTTP ${res.status}`);
      return res.text();
    }));
    batch.forEach((u, i) => {
      const text = texts[i]!;
      for (const spec of relativeSpecifiers(text)) {
        const dep = new URL(spec, u);
        if (!pathOf.has(dep.href)) {
          pathOf.set(dep.href, `${dir}${pathOf.size}.js`);
          queue.push(dep);
        }
      }
      const rewritten = rewriteSpecifiers(text, (spec) =>
        isRelativeSpecifier(spec) ? VIRTUAL + pathOf.get(new URL(spec, u).href)! : null,
      );
      files.push({ path: pathOf.get(u.href)!, data: rewritten });
    });
  }
  return { specifier: "cairn:three", aliases: ["three"], entry: `${dir}0.js`, files };
}
