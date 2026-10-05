/**
 * Drift guard for the two sandboxed frames that run user code:
 * - logged HTML (viewers/HtmlViewer.tsx) is its own server document, framed
 *   with the server's sandbox flags — never same-origin, never top-navigating;
 * - custom viewers (custom/ViewerFrame.tsx) keep their stricter lockdown:
 *   `sandbox="allow-scripts"` over a srcdoc.
 * Run: `npm run test:unit`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const REPO = join(SRC, "..", "..", "..");

test("logged HTML loads its server document in a sandbox without same-origin", () => {
  const viewer = read("components/viewers/HtmlViewer.tsx");
  const flags = /HTML_FRAME_SANDBOX = "([^"]+)"/.exec(viewer)?.[1];
  assert.equal(flags, "allow-scripts allow-popups allow-popups-to-escape-sandbox");
  assert.doesNotMatch(viewer, /srcDoc=/);
  assert.match(viewer, /sandbox=\{HTML_FRAME_SANDBOX\}/);
  assert.match(viewer, /src=\{url\}/);
  assert.match(read("api/client.ts"), /artifactHtmlUrl: .*\n?.*`\/api\/artifacts\/\$\{hash\}\/html/);
});

test("the frame's sandbox matches the server document's CSP sandbox", (t) => {
  let server: string;
  try {
    server = readFileSync(join(REPO, "cairn", "server", "routes", "artifacts.py"), "utf8");
  } catch {
    t.skip("not inside the cairn repo");
    return;
  }
  const csp = /HTML_DOC_SANDBOX = "sandbox ([^"]+)"/.exec(server)?.[1];
  const flags = /HTML_FRAME_SANDBOX = "([^"]+)"/.exec(read("components/viewers/HtmlViewer.tsx"))?.[1];
  assert.equal(csp, flags);
});

test("custom viewer frames keep their lockdown", () => {
  const frame = read("components/custom/ViewerFrame.tsx");
  const sandboxes = [...frame.matchAll(/sandbox="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(sandboxes.length > 0);
  for (const s of sandboxes) assert.equal(s, "allow-scripts");
  assert.match(frame, /srcDoc=/);
});
