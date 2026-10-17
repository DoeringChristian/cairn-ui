type Node = {type: string; value?: string; url?: string; children?: Node[]};
export function resolveReferences(tree: Node, references: Record<string, unknown>, blocks: {label?: string; caption?: string}[], citations?: string[]) {
  const keys = citations || Object.keys(references);
  const label = (key: string) => blocks.find(block => block.label === key);
  const link = (key: string): Node | null => keys.includes(key)
    ? {type: "link", url: `#ref-${key}`, children: [{type: "text", value: `[${keys.indexOf(key) + 1}]`}]}
    : label(key) ? {type: "link", url: `#${key}`, children: [{type: "text", value: label(key)!.caption || key}]} : null;
  const walk = (node: Node) => {
    if (!node.children || ["link", "code", "inlineCode", "html", "math", "inlineMath"].includes(node.type)) return;
    node.children = node.children.flatMap(child => {
      if (child.type !== "text" || !child.value) {walk(child); return [child];}
      const output: Node[] = []; let cursor = 0;
      const pattern = /\[@[\w:.-]+(?:\s*;\s*@[\w:.-]+)*\]|(?<![\w/])@[\w:.-]*[\w-]/g;
      for (const match of child.value.matchAll(pattern)) {
        const names = match[0].startsWith("[") ? match[0].slice(1, -1).split(/\s*;\s*/).map(key => key.slice(1)) : [match[0].slice(1)];
        const links = names.map(link); if (links.some(item => !item)) continue;
        output.push({type: "text", value: child.value.slice(cursor, match.index)});
        links.forEach((item, index) => {if (index) output.push({type: "text", value: "; "}); output.push(item!);});
        cursor = match.index! + match[0].length;
      }
      output.push({type: "text", value: child.value.slice(cursor)}); return output;
    });
  };
  walk(tree);
}

/** Sanitization prefixes IDs; repair only fragment links whose prefixed target exists. */
export function repairAnchorTargets(tree: {properties?: Record<string, unknown>; children?: unknown[]}) {
  type Element = {properties?: Record<string, unknown>; children?: Element[]};
  const ids = new Set<string>();
  const visit = (node: Element, action: (node: Element) => void) => {action(node); node.children?.forEach(child => visit(child, action));};
  visit(tree as Element, node => {if (typeof node.properties?.id === "string") ids.add(node.properties.id);});
  visit(tree as Element, node => {const href = node.properties?.href; if (typeof href !== "string" || !href.startsWith("#")) return; const id = href.slice(1); if (!ids.has(id) && ids.has(`user-content-${id}`)) node.properties!.href = `#user-content-${id}`;});
}
