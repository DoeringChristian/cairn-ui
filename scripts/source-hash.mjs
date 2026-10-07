// The fingerprint of everything the bundle is built from.
//
// `node scripts/source-hash.mjs write` (run by `npm run build`) records it in
// cairn_ui/_dist/.source-hash; `node scripts/source-hash.mjs check` (CI)
// recomputes it from the checked-out sources and fails when it differs, i.e.
// when sources changed but the committed bundle was not rebuilt.
//
// A fingerprint rather than comparing a fresh build with the committed one:
// builds are not byte-identical across platforms (module order, and so the
// minifier's names, differ between Linux and macOS), while the inputs are.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "cairn_ui", "_dist", ".source-hash");
/** Directories whose files the build reads (tests excluded: they are not bundled). */
const DIRS = ["src", "builtin-viewers"];
/** Single files the build reads. */
const FILES = [
  "index.html",
  "embed.html",
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  "tailwind.config.ts",
  "postcss.config.js",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
];
const SKIP = /(^|\/)(\.DS_Store|[^/]+\.test\.tsx?)$/;

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function sourceHash() {
  const files = [
    ...DIRS.flatMap((d) => walk(join(ROOT, d))),
    ...FILES.map((f) => join(ROOT, f)).filter((p) => existsSync(p)),
  ]
    .map((p) => relative(ROOT, p).split(sep).join("/"))
    .filter((rel) => !SKIP.test(rel))
    .sort();
  const h = createHash("sha256");
  for (const rel of files) {
    // Line endings normalised: a checkout with CRLF is the same source.
    const text = readFileSync(join(ROOT, rel)).toString("latin1").replace(/\r\n/g, "\n");
    h.update(rel).update("\0").update(text, "latin1").update("\0");
  }
  return h.digest("hex");
}

const mode = process.argv[2];
if (mode === "write") {
  writeFileSync(OUT, `${sourceHash()}\n`);
} else if (mode === "check") {
  const committed = existsSync(OUT) ? readFileSync(OUT, "utf8").trim() : "(none)";
  const now = sourceHash();
  if (committed !== now) {
    console.error(`cairn_ui/_dist is stale: built from ${committed}, sources are ${now}. Run 'npm run build' and commit the result.`);
    process.exit(1);
  }
  console.log(`cairn_ui/_dist matches the sources (${now.slice(0, 12)})`);
} else {
  console.error("usage: node scripts/source-hash.mjs write|check");
  process.exit(2);
}
