import type { HighlighterCore, LanguageRegistration, ThemeRegistration } from "shiki/core";

type Module<T> = Promise<{ default: T }>;

/**
 * The languages code is highlighted in, each imported on its own. The full
 * `shiki` bundle would emit a chunk for every one of its ~300 grammars and
 * ~60 themes (about 10 MB in the wheel) although only these are ever loaded.
 * Keep in step with `langFromPath` below; a language not listed renders as
 * plain text.
 */
export const SHIKI_LANGS: Record<string, () => Module<LanguageRegistration[]>> = {
  python: () => import("shiki/langs/python.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
};

/** The one theme code is shown in. */
export const SHIKI_THEME = "github-dark";
const loadTheme = (): Module<ThemeRegistration> => import("shiki/themes/github-dark.mjs");

let highlighterPromise: Promise<HighlighterCore> | null = null;

export function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= Promise.all([import("shiki/core"), import("shiki/engine/oniguruma")]).then(
    ([{ createHighlighterCore }, { createOnigurumaEngine }]) =>
      createHighlighterCore({
        themes: [loadTheme()],
        langs: Object.values(SHIKI_LANGS).map((load) => load()),
        engine: createOnigurumaEngine(import("shiki/wasm")),
      }),
  );
  return highlighterPromise;
}

export function langFromPath(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    py: "python",
    ts: "typescript",
    tsx: "typescript",
    mjs: "javascript",
    cjs: "javascript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    md: "markdown",
    ini: "ini",
    cfg: "ini",
    sh: "bash",
    bash: "bash",
    html: "html",
    htm: "html",
    css: "css",
    diff: "diff",
    patch: "diff",
    jsonl: "json",
  };
  return map[ext] ?? null;
}
