import { test } from "node:test";
import assert from "node:assert/strict";

import { getHighlighter, langFromPath, SHIKI_LANGS, SHIKI_THEME } from "./syntax-highlight.ts";

const SAMPLES: Record<string, string> = {
  python: "def f(x):\n    return x + 1\n",
  typescript: "const n: number = 1;\n",
  javascript: "export const n = 1;\n",
  json: '{"a": [1, true]}\n',
  yaml: "a: 1\nb: [x, y]\n",
  toml: '[tool]\nname = "x"\n',
  markdown: "# Title\n\n*text*\n",
  ini: "[section]\nkey = value\n",
  bash: "echo \"$HOME\" | wc -l\n",
  html: "<div class=\"a\">hi</div>\n",
  css: ".a { color: red; }\n",
  diff: "--- a\n+++ b\n-old\n+new\n",
};

test("every listed language highlights (tokens get theme colours)", async () => {
  const h = await getHighlighter();
  assert.deepEqual(Object.keys(SAMPLES).sort(), Object.keys(SHIKI_LANGS).sort());
  for (const [lang, code] of Object.entries(SAMPLES)) {
    const html = h.codeToHtml(code, { lang, theme: SHIKI_THEME });
    const colours = new Set(html.match(/color:#[0-9A-Fa-f]{6}/g));
    assert.ok(colours.size >= 2, `${lang}: ${html}`);
  }
});

test("every language langFromPath names is loaded", () => {
  const exts = ["py", "ts", "tsx", "mjs", "cjs", "js", "jsx", "json", "yaml", "yml", "toml", "md", "ini", "cfg", "sh", "bash", "html", "htm", "css", "diff", "patch", "jsonl"];
  for (const ext of exts) {
    const lang = langFromPath(`f.${ext}`);
    assert.ok(lang && lang in SHIKI_LANGS, `${ext} -> ${lang}`);
  }
  assert.equal(langFromPath("f.unknown"), null);
});
