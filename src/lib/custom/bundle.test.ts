/** Viewer bundles: specifier rewriting and the import map. Run: `npm run test:unit`. */
import assert from "node:assert/strict";
import test from "node:test";

import { buildViewerBundle, relativeSpecifiers, resolveIn, rewriteSpecifiers, VIRTUAL } from "./bundle.ts";

const text = (b: ReturnType<typeof buildViewerBundle>, path: string) => {
  const f = b.files.find((x) => x.path === path);
  assert.ok(f, `no ${path}`);
  return f.data as string;
};

test("relative specifiers: static, re-export, side effect, dynamic, minified", () => {
  const src = `import a from "./a.js";
import {b} from '../b.js'
export * from "./c.js";
export { d } from "/d.js";
import "./e.js";
const f = await import( "./f.js" );
import x from "d3"; import y from "https://x/y.js"; import z from "//cdn/z.js";
const s = Array.from("./not-an-import");
import{g}from"./g.js";export{h}from"./h.js";`;
  assert.deepEqual(relativeSpecifiers(src), ["./a.js", "../b.js", "./c.js", "/d.js", "./e.js", "./f.js", "./g.js", "./h.js"]);
});

test("rewriteSpecifiers keeps quotes and leaves bare/URL specifiers", () => {
  const out = rewriteSpecifiers(`import a from './a.js'; import b from "d3"; import("./c.js")`, (s) => `X${s}`);
  assert.equal(out, `import a from 'X./a.js'; import b from "d3"; import("X./c.js")`);
});

test("resolveIn", () => {
  assert.equal(resolveIn("index.js", "./a.js"), "a.js");
  assert.equal(resolveIn("src/x/y.js", "../z.js"), "src/z.js");
  assert.equal(resolveIn("src/y.js", "/vendor/d3.js"), "vendor/d3.js");
  assert.equal(resolveIn("y.js", "../out.js"), null);
  assert.equal(resolveIn("y.js", "./a.js?raw"), "a.js");
});

const files = [
  { path: "cairn-viewer.json", data: "{}" },
  { path: "index.js", data: `import * as d3 from "d3"; import { OrbitControls } from "three/addons/controls/OrbitControls.js"; import { f } from "./src/util.js"; import data from "./data.json" with { type: "json" };` },
  { path: "src/util.js", data: `export { g } from "../src/deep/g.js"; export const f = 1;` },
  { path: "src/deep/g.js", data: `import { f } from "../util.js"; export const g = () => f;` },
  { path: "vendor/d3.js", data: `import "./d3-chunk.js"; export const scale = 1;` },
  { path: "vendor/d3-chunk.js", data: `export {}` },
  { path: "vendor/three-addons/controls/OrbitControls.js", data: `import { Vector3 } from "three"; import { x } from "../utils/x.js"; export class OrbitControls {}` },
  { path: "vendor/three-addons/utils/x.js", data: `export const x = 1;` },
  { path: "data.json", data: new TextEncoder().encode(`{"a":1}`) },
  { path: "tex.png", data: new Uint8Array([137, 80, 78, 71]) },
];
const manifest = { entry: "index.js", imports: { d3: "vendor/d3.js", "three/addons/": "vendor/three-addons/" } };
const three = {
  specifier: "cairn:three",
  aliases: ["three"],
  entry: "__cairn/three/ns.js",
  files: [
    { path: "__cairn/three/ns.js", data: `export * from "${VIRTUAL}__cairn/three/core.js";` },
    { path: "__cairn/three/core.js", data: `export const Vector3 = 1;` },
  ],
};
const sdk = { specifier: "cairn:sdk", entry: "__cairn/sdk.js", files: [{ path: "__cairn/sdk.js", data: "export {}" }] };

test("the import map: virtual paths, vendored bare + prefix mappings, provided modules", () => {
  const b = buildViewerBundle(manifest, files, [sdk, three]);
  assert.deepEqual(b.warnings, []);
  assert.equal(b.entry, `${VIRTUAL}index.js`);
  assert.deepEqual(b.imports, {
    [`${VIRTUAL}cairn-viewer.json`]: "cairn-viewer.json",
    [`${VIRTUAL}index.js`]: "index.js",
    [`${VIRTUAL}src/util.js`]: "src/util.js",
    [`${VIRTUAL}src/deep/g.js`]: "src/deep/g.js",
    [`${VIRTUAL}vendor/d3.js`]: "vendor/d3.js",
    [`${VIRTUAL}vendor/d3-chunk.js`]: "vendor/d3-chunk.js",
    [`${VIRTUAL}vendor/three-addons/controls/OrbitControls.js`]: "vendor/three-addons/controls/OrbitControls.js",
    [`${VIRTUAL}vendor/three-addons/utils/x.js`]: "vendor/three-addons/utils/x.js",
    [`${VIRTUAL}data.json`]: "data.json",
    [`${VIRTUAL}tex.png`]: "tex.png",
    d3: "vendor/d3.js",
    "three/addons/controls/OrbitControls.js": "vendor/three-addons/controls/OrbitControls.js",
    "three/addons/utils/x.js": "vendor/three-addons/utils/x.js",
    [`${VIRTUAL}__cairn/sdk.js`]: "__cairn/sdk.js",
    "cairn:sdk": "__cairn/sdk.js",
    [`${VIRTUAL}__cairn/three/ns.js`]: "__cairn/three/ns.js",
    [`${VIRTUAL}__cairn/three/core.js`]: "__cairn/three/core.js",
    "cairn:three": "__cairn/three/ns.js",
    three: "__cairn/three/ns.js",
  });
});

test("nested relative imports inside vendored files and cycles become virtual", () => {
  const b = buildViewerBundle(manifest, files, [sdk, three]);
  assert.match(text(b, "index.js"), /from "cairn-viewer:\/src\/util\.js"/);
  assert.match(text(b, "index.js"), /from "cairn-viewer:\/data\.json" with/);
  assert.match(text(b, "index.js"), /from "d3"/, "bare specifiers stay for the import map");
  assert.match(text(b, "src/util.js"), /from "cairn-viewer:\/src\/deep\/g\.js"/);
  assert.match(text(b, "src/deep/g.js"), /from "cairn-viewer:\/src\/util\.js"/);
  assert.match(text(b, "vendor/d3.js"), /import "cairn-viewer:\/vendor\/d3-chunk\.js"/);
  assert.match(text(b, "vendor/three-addons/controls/OrbitControls.js"), /from "cairn-viewer:\/vendor\/three-addons\/utils\/x\.js"/);
  assert.match(text(b, "vendor/three-addons/controls/OrbitControls.js"), /from "three"/);
  const png = b.files.find((f) => f.path === "tex.png")!;
  assert.equal(png.mime, "image/png");
  assert.ok(png.data instanceof ArrayBuffer);
  assert.equal(b.files.find((f) => f.path === "data.json")!.mime, "application/json");
});

test("a vendored three wins over the host's", () => {
  const b = buildViewerBundle({ entry: "index.js", imports: { three: "vendor/three.js" } }, [
    { path: "index.js", data: `import * as T from "three";` },
    { path: "vendor/three.js", data: `export {}` },
  ], [three]);
  assert.equal(b.imports.three, "vendor/three.js");
  assert.equal(b.imports["cairn:three"], "__cairn/three/ns.js");
});

test("warnings for imports naming no file; errors for a missing entry or the reserved folder", () => {
  const b = buildViewerBundle({ entry: "index.js", imports: { d3: "vendor/d3.js", "x/": "vendor/x/" } }, [
    { path: "index.js", data: `import "./missing.js";` },
  ]);
  assert.deepEqual(b.warnings, [
    `index.js imports "./missing.js", which is not in the viewer`,
    `imports["d3"]: "vendor/d3.js" is not in the viewer`,
    `imports["x/"]: no files under "vendor/x/"`,
  ]);
  assert.match(text(b, "index.js"), /import "\.\/missing\.js"/);
  assert.throws(() => buildViewerBundle({ entry: "main.js", imports: {} }, [{ path: "index.js", data: "" }]), /entry "main.js"/);
  assert.throws(() => buildViewerBundle({ entry: "index.js", imports: {} }, [{ path: "index.js", data: "" }, { path: "__cairn/x.js", data: "" }]), /cairn's/);
});
