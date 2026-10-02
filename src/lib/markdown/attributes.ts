/**
 * Pandoc attribute blocks — `{#id .class key=value key="quoted value" -}` —
 * parsed, then narrowed to what the renderer lets through.
 *
 * Security contract (see lib/markdown.tsx): an attribute block never sets an
 * arbitrary HTML attribute. Only these pass:
 * - `id`: letters, digits, `_`, `-`, `.`, `:`; starting with a letter.
 * - classes: letters, digits, `_`, `-`; rendered with an `md-` prefix so a
 *   class can never pick up one of the app's own (Tailwind) utility styles
 *   (`{.fixed .inset-0}` stays harmless). A few classes have a meaning of
 *   their own instead (callout kinds on fenced divs, `smallcaps` /
 *   `underline` / `mark` on spans, `unnumbered` on headings); those are read
 *   by the transforms before the prefixing.
 * - `title`, `lang`, `dir` (`ltr`/`rtl`/`auto`), and on images `width` /
 *   `height` as a number with an optional `px`/`%`/`em`/`rem` unit.
 * Everything else (`onclick=…`, `style=…`, `href=…`, …) is dropped.
 */

export interface PandocAttributes {
  id: string | null;
  classes: string[];
  /** key → value, in source order; values unquoted. */
  pairs: [string, string][];
}

const ID = /^[A-Za-z][\w.:-]*$/;
const CLASS = /^[A-Za-z_][\w-]*$/;
const SIZE = /^\d+(?:\.\d+)?(?:px|%|em|rem)?$/;
const DIR = /^(?:ltr|rtl|auto)$/;

/**
 * Parse the inside of a `{…}` attribute block (without the braces). Returns
 * null when it isn't one (an empty block, or text that doesn't tokenize).
 */
export function parseAttributes(src: string): PandocAttributes | null {
  const out: PandocAttributes = { id: null, classes: [], pairs: [] };
  let s = src.trim();
  if (!s) return null;
  // `{-}` is pandoc's short form of `.unnumbered`.
  if (s === "-") return { ...out, classes: ["unnumbered"] };
  while (s) {
    let m: RegExpExecArray | null;
    if ((m = /^#([^\s#.=]+)/.exec(s))) out.id = m[1]!;
    else if ((m = /^\.([^\s#.=]+)/.exec(s))) out.classes.push(m[1]!);
    else if ((m = /^([A-Za-z_][\w:.-]*)=(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"']+))/.exec(s)))
      out.pairs.push([m[1]!, (m[2] ?? m[3] ?? m[4] ?? "").replace(/\\(.)/g, "$1")]);
    else if ((m = /^-(?=\s|$)/.exec(s))) out.classes.push("unnumbered");
    else return null;
    s = s.slice(m[0].length).trimStart();
  }
  return out;
}

/** The value of `key` (the last one wins, as in pandoc). */
export function attr(a: PandocAttributes, key: string): string | undefined {
  let v: string | undefined;
  for (const [k, val] of a.pairs) if (k === key) v = val;
  return v;
}

/**
 * The hast properties an attribute block may set. `except` lists classes a
 * transform already consumed (they don't render as `md-…`).
 */
export function safeProperties(
  a: PandocAttributes,
  opts: { image?: boolean; except?: readonly string[] } = {},
): Record<string, string | string[]> {
  const props: Record<string, string | string[]> = {};
  if (a.id && ID.test(a.id)) props.id = a.id;
  const classes = a.classes.filter((c) => CLASS.test(c) && !opts.except?.includes(c)).map((c) => `md-${c}`);
  if (classes.length) props.className = classes;
  const title = attr(a, "title");
  if (title !== undefined) props.title = title;
  const lang = attr(a, "lang");
  if (lang !== undefined && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(lang)) props.lang = lang;
  const dir = attr(a, "dir");
  if (dir !== undefined && DIR.test(dir)) props.dir = dir;
  if (opts.image) {
    const style: string[] = [];
    for (const key of ["width", "height"] as const) {
      const v = attr(a, key);
      if (v !== undefined && SIZE.test(v)) style.push(`${key}:${/\d$/.test(v) ? `${v}px` : v}`);
    }
    if (style.length) props.style = style.join(";");
  }
  return props;
}

/** A trailing ` {…}` attribute block on a heading's text: the text without it, and the block. */
export function splitTrailingAttributes(text: string): { text: string; attrs: PandocAttributes } | null {
  const m = /[ \t]+\{([^{}\n]*)\}[ \t]*$/.exec(text);
  if (!m) return null;
  const attrs = parseAttributes(m[1]!);
  return attrs ? { text: text.slice(0, m.index), attrs } : null;
}
