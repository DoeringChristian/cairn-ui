/** Chart colors read from the app's theme tokens (index.css :root), so charts follow light/dark. */
export interface ChartTheme {
  fg: string;
  fgMuted: string;
  grid: string;
  bg: string;
  accent: string;
  mono: string;
}

export function readChartTheme(el: Element | null): ChartTheme {
  const style = getComputedStyle(el ?? document.documentElement);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    fg: token("--color-fg", "#1f2328"),
    fgMuted: token("--color-fg-muted", "#656d76"),
    grid: token("--color-border-subtle", "#eaeef2"),
    bg: token("--color-bg-elevated", "#ffffff"),
    accent: token("--color-accent", "#0969da"),
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  };
}

/** `#rrggbb` → `rgba(r, g, b, a)`; other color strings pass through. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
