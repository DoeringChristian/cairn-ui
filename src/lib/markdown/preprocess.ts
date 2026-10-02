/**
 * Line rewrites run on the source before parsing, outside fenced code, for
 * the two Pandoc block syntaxes whose markers the parsers spell differently.
 * Each rewrite stays on its own line, so source line numbers (heading ids,
 * see heading-ids.ts) are unchanged.
 *
 * - Fenced divs: pandoc's `::: {.note #id}`, `::: note`, `:::{.x}` and
 *   `::: note :::` openers become remark-directive containers
 *   (`:::div{.note #id}`, `:::note`). Closing `:::` lines are the same in both.
 * - Definition lists: a `~` definition marker becomes `:` (the parser only
 *   knows `:`), when a term line comes before it.
 */

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
/** Optional blockquote/indent prefix, the colons, then a class name and/or an attribute block. */
const DIV_OPEN = /^((?: {0,3}> ?)*)( {0,3})(:{3,})[ \t]*(?:([A-Za-z][\w-]*)[ \t]*)?(\{[^{}\n]*\})?[ \t]*:*[ \t]*$/;
const TILDE_DEF = /^( {0,3})~([ \t]+)(?=\S)/;

export function preprocessPandoc(md: string): string {
  if (!md.includes(":::") && !md.includes("~")) return md;
  const lines = md.split("\n");
  let fence: { char: string; len: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (fence) {
      const close = new RegExp(`^ {0,3}${fence.char === "`" ? "`" : "~"}{${fence.len},}[ \\t]*$`);
      if (close.test(line)) fence = null;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      fence = { char: open[1]![0]!, len: open[1]!.length };
      continue;
    }
    const div = DIV_OPEN.exec(line);
    if (div && (div[4] || div[5])) {
      lines[i] = `${div[1]}${div[2]}${div[3]}${div[4] ?? "div"}${div[5] ?? ""}`;
      continue;
    }
    // Only after a term (the line before, or the one before a blank line), as pandoc requires.
    const tilde = TILDE_DEF.exec(line);
    const term = (lines[i - 1] ?? "").trim() !== "" || (i >= 2 && lines[i - 2]!.trim() !== "");
    if (tilde && term) lines[i] = `${tilde[1]}:${tilde[2]}${line.slice(tilde[0].length)}`;
  }
  return lines.join("\n");
}
