/**
 * Append a cards cell to a report's markdown source without touching a byte
 * of what is already there: the result always starts with `source`. Only a
 * separator (a blank line) goes between the old text and the new ```cairn
 * fence; a source that ends inside an unclosed code fence gets that fence
 * closed first, so the new fence isn't swallowed by it.
 */

import { serializeCairnSpec, stringifyCairnSpec } from "./cairn-block.ts";
import { CAIRN_FENCE_LANG } from "./markdown-source.ts";
import type { CardsBlock } from "./types";

/** The closing line an unclosed fence at the end of `source` needs, or null. */
function unclosedFence(source: string): string | null {
  let open: { char: string; len: number } | null = null;
  for (const line of source.split("\n")) {
    if (open) {
      const close = new RegExp(`^ {0,3}${open.char === "`" ? "`" : "~"}{${open.len},}[ \\t]*$`);
      if (close.test(line)) open = null;
      continue;
    }
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (m) open = { char: m[1]![0]!, len: m[1]!.length };
  }
  return open ? open.char.repeat(open.len) : null;
}

/**
 * `source` + a ```cairn fence for `block`. `settings` maps card id → that
 * card's settings overrides, written inline under the card.
 */
export function appendCardsFence(source: string, block: CardsBlock, settings: Record<string, unknown> = {}): string {
  const fence = `\`\`\`${CAIRN_FENCE_LANG}\n${stringifyCairnSpec(serializeCairnSpec(block, settings))}\n\`\`\`\n`;
  let out = source;
  const close = unclosedFence(source);
  if (close) out += `${out.endsWith("\n") ? "" : "\n"}${close}\n`;
  if (out === "") return fence;
  const sep = out.endsWith("\n\n") ? "" : out.endsWith("\n") ? "\n" : "\n\n";
  return out + sep + fence;
}
