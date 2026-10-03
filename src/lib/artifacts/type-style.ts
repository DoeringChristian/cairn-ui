/**
 * One color per artifact type, shared by the explorer's badges and the
 * lineage graph's version cards. Common types have fixed colors; any other
 * type hashes into the palette, so it is stable across pages and sessions.
 */

const FIXED: Record<string, string> = {
  dataset: "#0969da",
  model: "#1a7f37",
  code: "#8250df",
  report: "#bc4c00",
  evaluation: "#9a6700",
};

const PALETTE = ["#0969da", "#1a7f37", "#8250df", "#bc4c00", "#9a6700", "#bf3989", "#1b7c83", "#6e7781"];

export function typeColor(type: string): string {
  const fixed = FIXED[type];
  if (fixed) return fixed;
  let h = 0;
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** Inline style for a type badge: tinted background, colored text and border. */
export function typeBadgeStyle(type: string): { color: string; backgroundColor: string; borderColor: string } {
  const c = typeColor(type);
  return { color: c, backgroundColor: `${c}14`, borderColor: `${c}55` };
}
