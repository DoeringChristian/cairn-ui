export type TextAnchor = { block_id: string; offset: number };
export type TextSelection = {
  schema: "cairn.text-selection/v1";
  exact: string;
  prefix: string;
  suffix: string;
  start: TextAnchor;
  end: TextAnchor;
};

// Positions refer to rendered text, not Markdown bytes. Quotes/context allow
// reanchoring after presentation changes; the report revision stays immutable.
function textNodes(element: Element): Text[] {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.parentElement?.closest('[data-selection-ignore],.katex-mathml,[aria-hidden="true"],button,script,style')) nodes.push(node);
  }
  return nodes;
}

export function readTextSelection(root: HTMLElement, range: Range): TextSelection | null {
  if (range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const parts: { id: string; text: string; start: number; end: number }[] = [];
  for (const element of root.querySelectorAll<HTMLElement>('[data-report-text]')) {
    const nodes = textNodes(element);
    let text = "", start: number | undefined, end = 0;
    for (const node of nodes) {
      const offset = text.length;
      text += node.data;
      if (!range.intersectsNode(node)) continue;
      const from = range.startContainer === node ? range.startOffset : 0;
      const to = range.endContainer === node ? range.endOffset : node.length;
      if (to > from) { start ??= offset + from; end = offset + to; }
    }
    if (start !== undefined) parts.push({ id: element.dataset.reportText!, text, start, end });
  }
  if (!parts.length) return null;
  const first = parts[0], last = parts[parts.length - 1];
  const exact = parts.map(part => part.text.slice(part.start, part.end)).join("\n\n");
  if (!exact.trim()) return null;
  if (new TextEncoder().encode(exact).length > 16384) throw new Error("Select a shorter passage (up to 16 KB of text).");
  return {
    schema: "cairn.text-selection/v1", exact,
    prefix: Array.from(first.text.slice(0, first.start)).slice(-64).join(""),
    suffix: Array.from(last.text.slice(last.end)).slice(0, 64).join(""),
    start: { block_id: first.id, offset: first.start },
    end: { block_id: last.id, offset: last.end },
  };
}

export function locateTextSelection(root: HTMLElement, selected: TextSelection): Range | null {
  const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-report-text]'));
  const first = elements.findIndex(el => el.dataset.reportText === selected.start.block_id);
  const last = elements.findIndex(el => el.dataset.reportText === selected.end.block_id);
  if (first < 0 || last < first) return null;
  const groups = elements.slice(first, last + 1).map(el => textNodes(el));
  const texts = groups.map(nodes => nodes.map(node => node.data).join(""));
  let from = selected.start.offset, to = selected.end.offset;
  const atOffsets = texts.map((text, i) => text.slice(i === 0 ? from : 0, i === texts.length - 1 ? to : undefined)).join("\n\n");
  if (atOffsets !== selected.exact) {
    const combined = texts.join("\n\n"), matches: number[] = [];
    for (let pos = combined.indexOf(selected.exact); pos >= 0; pos = combined.indexOf(selected.exact, pos + 1)) {
      if ((!selected.prefix || combined.slice(0, pos).endsWith(selected.prefix)) && (!selected.suffix || combined.slice(pos + selected.exact.length).startsWith(selected.suffix))) matches.push(pos);
    }
    if (matches.length !== 1) return null; // Never silently highlight a different repeated passage.
    from = matches[0]; to = from + selected.exact.length - texts.slice(0, -1).reduce((sum, text) => sum + text.length + 2, 0);
    if (from > texts[0].length || to < 0 || to > texts[texts.length - 1].length) return null;
  }
  const endpoint = (nodes: Text[], offset: number): [Text, number] | null => {
    for (const node of nodes) { if (offset <= node.length) return [node, offset]; offset -= node.length; }
    return null;
  };
  const start = endpoint(groups[0], from), end = endpoint(groups[groups.length - 1], to);
  if (!start || !end) return null;
  const range = root.ownerDocument.createRange(); range.setStart(...start); range.setEnd(...end);
  return range;
}
