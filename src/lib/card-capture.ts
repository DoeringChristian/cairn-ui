/**
 * The card header's screenshot and download, for every card type (the
 * shared actions of components/card-header/CardHeaderActions.tsx).
 *
 * Screenshot (`captureCardPng`): the card's body as displayed, as one PNG —
 * a faithful clone (computed styles, pseudo-elements, scroll offsets, form
 * state, fonts embedded; canvases, images, video frames, custom viewers'
 * `snapshot()` and logged HTML's own picture in place of what an SVG cannot
 * draw) rendered by the browser through an SVG `<foreignObject>`, at the
 * device's pixel ratio. `collectLayers` serves the reports' LaTeX export
 * (charts only).
 *
 * The artifacts a card shows at its step (`cardArtifacts`): every viewer
 * marks its root with `data-cairn-artifact` (the content hash). The
 * downloads themselves are lib/download.ts `downloadCardPng` /
 * `downloadCardArtifacts`.
 */

import { snapshotFrame } from "./custom/frame-snapshots";

export interface Layer {
  rect: DOMRect;
  source: CanvasImageSource;
}

const CUSTOM_VIEWER = '[data-viewer="custom"]';
const HTML_FRAME = "iframe[data-cairn-html]";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

/** Ask a logged HTML document (its server shim) for a picture of what it shows. */
function snapshotHtmlFrame(frame: HTMLIFrameElement, timeoutMs = 8000): Promise<string | null> {
  const win = frame.contentWindow;
  if (!win) return Promise.resolve(null);
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const done = (url: string | null) => {
      window.removeEventListener("message", onMsg);
      clearTimeout(t);
      resolve(url);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== win || e.data?.type !== "cairn:snapshot" || e.data.id !== id) return;
      done(typeof e.data.url === "string" ? e.data.url : null);
    };
    const t = setTimeout(() => done(null), timeoutMs);
    window.addEventListener("message", onMsg);
    win.postMessage({ type: "cairn:snapshot", id }, "*");
  });
}

/** What the DOM picture cannot hold, under `container`, at its on-screen place. */
export async function collectLayers(container: HTMLElement, scale = 2): Promise<Layer[]> {
  const layers: Layer[] = [];
  // A plot paused by the page's WebGL budget is purged (no `_fullLayout`): its snapshot image is a layer like any image.
  const plots = Array.from(container.querySelectorAll<HTMLElement>(".js-plotly-plot")).filter(
    (p) => (p as HTMLElement & { _fullLayout?: unknown })._fullLayout != null,
  );
  if (plots.length > 0) {
    const Plotly = await (await import("../charts/PlotlyChart")).loadPlotly();
    for (const plot of plots) {
      const url: string = await Plotly.toImage(plot, { format: "png", width: plot.clientWidth, height: plot.clientHeight, scale });
      layers.push({ rect: plot.getBoundingClientRect(), source: await loadImage(url) });
    }
  }
  for (const box of container.querySelectorAll<HTMLElement>(CUSTOM_VIEWER)) {
    const url = await snapshotFrame(box);
    if (url) layers.push({ rect: box.getBoundingClientRect(), source: await loadImage(url) });
  }
  for (const frame of container.querySelectorAll<HTMLIFrameElement>(HTML_FRAME)) {
    const url = await snapshotHtmlFrame(frame);
    if (url) layers.push({ rect: frame.getBoundingClientRect(), source: await loadImage(url).catch(() => new Image()) });
  }
  const skip = (el: Element) => plots.some((p) => p.contains(el)) || el.closest(CUSTOM_VIEWER) != null || el.closest(HTML_FRAME) != null;
  for (const canvas of container.querySelectorAll<HTMLCanvasElement>("canvas")) {
    if (skip(canvas) || canvas.width === 0 || canvas.height === 0) continue;
    layers.push({ rect: canvas.getBoundingClientRect(), source: canvas });
  }
  for (const img of container.querySelectorAll<HTMLImageElement>("img")) {
    if (skip(img) || !img.complete || img.naturalWidth === 0) continue;
    layers.push({ rect: img.getBoundingClientRect(), source: img });
  }
  for (const video of container.querySelectorAll<HTMLVideoElement>("video")) {
    if (skip(video) || video.readyState < 2) continue;
    layers.push({ rect: video.getBoundingClientRect(), source: video });
  }
  return layers.filter((l) => l.rect.width > 0 && l.rect.height > 0);
}

// ---------------------------------------------------------------------------
// The card as displayed: one faithful clone, rendered by the browser itself
// ---------------------------------------------------------------------------

/** A computed style as a declaration list. */
function cssText(cs: CSSStyleDeclaration): string {
  let css = "";
  for (let i = 0; i < cs.length; i++) {
    const p = cs[i]!;
    css += `${p}:${cs.getPropertyValue(p)};`;
  }
  return css;
}

/** Canvas pixels as a data URL ("" when unreadable). */
function canvasUrl(c: HTMLCanvasElement): string {
  try {
    return c.toDataURL("image/png");
  } catch {
    return "";
  }
}

/** An image or a video's current frame as a data URL, at its natural size ("" when unreadable). */
function mediaUrl(el: HTMLImageElement | HTMLVideoElement): string {
  const w = el instanceof HTMLImageElement ? el.naturalWidth : el.videoWidth;
  const h = el instanceof HTMLImageElement ? el.naturalHeight : el.videoHeight;
  if (!w || !h) return "";
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  try {
    c.getContext("2d")!.drawImage(el, 0, 0, w, h);
    return c.toDataURL("image/png");
  } catch {
    return el instanceof HTMLImageElement ? el.currentSrc || el.src : "";
  }
}

const fontCache = new Map<string, Promise<string>>();

/** The page's `@font-face` rules for `families`, their files inlined (an SVG picture loads nothing). */
async function embeddedFonts(families: ReadonlySet<string>): Promise<string> {
  const rules: Array<{ rule: CSSFontFaceRule; base: string }> = [];
  const walk = (list: CSSRuleList, base: string) => {
    for (const r of Array.from(list)) {
      if (r instanceof CSSFontFaceRule) rules.push({ rule: r, base });
      else if ("cssRules" in r && (r as CSSGroupingRule).cssRules) walk((r as CSSGroupingRule).cssRules, base);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules, sheet.href ?? location.href);
    } catch {
      /* a stylesheet we may not read */
    }
  }
  const out: string[] = [];
  for (const { rule, base } of rules) {
    const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
    if (!families.has(family)) continue;
    const key = `${base}|${rule.cssText}`;
    let text = fontCache.get(key);
    if (!text) {
      text = (async () => {
        let css = rule.cssText;
        for (const m of [...css.matchAll(/url\((["']?)([^"')]+)\1\)/g)]) {
          if (m[2]!.startsWith("data:")) continue;
          try {
            const blob = await (await fetch(new URL(m[2]!, base).href)).blob();
            const data = await new Promise<string>((res) => {
              const fr = new FileReader();
              fr.onload = () => res(String(fr.result));
              fr.readAsDataURL(blob);
            });
            css = css.replace(m[0], `url("${data}")`);
          } catch {
            /* that format stays a reference: the next src still works */
          }
        }
        return css;
      })();
      fontCache.set(key, text);
    }
    out.push(await text);
  }
  return out.join("\n");
}

/**
 * A clone of `root` that draws exactly like it: every element's computed
 * style inline, its `::before` / `::after` as rules, form values, scroll
 * offsets, and in place of what an SVG picture cannot draw itself the pixels
 * the page shows now — canvases (uPlot, three.js), images and video frames,
 * custom viewers (their `snapshot()`) and logged HTML (its shim's picture).
 * Laid out by the browser with the same CSS (object-fit, transforms,
 * clipping, stacking), so the picture is the card as displayed.
 */
async function faithfulClone(root: HTMLElement): Promise<{ clone: HTMLElement; css: string; families: Set<string> }> {
  // What the frames show, asked for first (they answer asynchronously).
  const frameShots = new Map<Element, Promise<string | null>>();
  for (const box of root.querySelectorAll<HTMLElement>(CUSTOM_VIEWER)) frameShots.set(box, snapshotFrame(box));
  for (const f of root.querySelectorAll<HTMLIFrameElement>(HTML_FRAME)) frameShots.set(f, snapshotHtmlFrame(f));
  const shots = new Map<Element, string | null>();
  for (const [el, p] of frameShots) shots.set(el, await p);

  const clone = root.cloneNode(true) as HTMLElement;
  const pseudo: string[] = [];
  const families = new Set<string>();
  const scrolled: Array<{ el: HTMLElement; x: number; y: number }> = [];
  let n = 0;
  const visit = (o: Element, c: Element) => {
    const cs = getComputedStyle(o);
    c.setAttribute("style", cssText(cs));
    for (const f of cs.fontFamily.split(",")) families.add(f.replace(/["']/g, "").trim());
    for (const which of ["::before", "::after"] as const) {
      const ps = getComputedStyle(o, which);
      if (ps.content && ps.content !== "none" && ps.content !== "normal") {
        const cls = `cairn-cap-${n++}`;
        c.setAttribute("class", `${c.getAttribute("class") ?? ""} ${cls}`);
        pseudo.push(`.${cls}${which}{${cssText(ps)}}`);
        for (const f of ps.fontFamily.split(",")) families.add(f.replace(/["']/g, "").trim());
      }
    }
    if (o instanceof HTMLElement && (o.scrollTop || o.scrollLeft)) scrolled.push({ el: c as HTMLElement, x: o.scrollLeft, y: o.scrollTop });
    // A scrollbar the page does not show (overlay scrollbars, nothing to scroll yet) is not drawn either.
    if (o instanceof HTMLElement && /auto|scroll/.test(cs.overflow)) {
      const bx = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
      const by = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      if (o.offsetWidth - o.clientWidth - bx < 1 && o.offsetHeight - o.clientHeight - by < 1) (c as HTMLElement).style.setProperty("scrollbar-width", "none");
    }
    const replaceWith = (url: string) => {
      const img = document.createElement("img");
      img.setAttribute("style", c.getAttribute("style") ?? "");
      if (url) img.setAttribute("src", url);
      c.replaceWith(img);
    };
    if (o instanceof HTMLCanvasElement) return replaceWith(canvasUrl(o));
    if (o instanceof HTMLVideoElement) return replaceWith(mediaUrl(o));
    if (o instanceof HTMLImageElement) {
      c.removeAttribute("srcset");
      c.setAttribute("src", o.complete ? mediaUrl(o) : "");
      return;
    }
    if (o instanceof HTMLIFrameElement) {
      const box = o.closest(CUSTOM_VIEWER);
      return replaceWith((shots.get(o) ?? (box ? shots.get(box) : null)) ?? "");
    }
    if (o instanceof HTMLInputElement || o instanceof HTMLTextAreaElement) {
      if (o.type === "checkbox" || o.type === "radio") {
        if ((o as HTMLInputElement).checked) c.setAttribute("checked", "");
        else c.removeAttribute("checked");
      } else c.setAttribute("value", o.value);
      if (o instanceof HTMLTextAreaElement) c.textContent = o.value;
    }
    if (o instanceof HTMLSelectElement) {
      Array.from((c as HTMLSelectElement).options).forEach((opt, i) => {
        if (i === o.selectedIndex) opt.setAttribute("selected", "");
        else opt.removeAttribute("selected");
      });
    }
    const oc = o.children;
    const cc = Array.from(c.children);
    for (let i = 0; i < oc.length; i++) if (cc[i]) visit(oc[i]!, cc[i]!);
  };
  visit(root, clone);
  // Scroll offsets: an SVG picture does not scroll, so the scrolled content moves instead.
  for (const { el, x, y } of scrolled) {
    for (const child of Array.from(el.children) as HTMLElement[]) {
      const t = child.style.getPropertyValue("transform");
      child.style.setProperty("transform", `translate(${-x}px, ${-y}px)${t && t !== "none" ? ` ${t}` : ""}`);
    }
  }
  for (const s of clone.querySelectorAll("script")) s.remove();
  clone.style.margin = "0";
  return { clone, css: pseudo.join("\n"), families };
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"));
}

/**
 * The body of card `card` (below its header) as one PNG, as displayed now:
 * its size, the device's pixel ratio, zoom and camera, step, scroll.
 */
export async function captureCardPng(card: HTMLElement, scale = window.devicePixelRatio || 1): Promise<Blob> {
  const cardRect = card.getBoundingClientRect();
  const header = card.querySelector<HTMLElement>("[data-cairn-card-header]");
  const top = header ? header.getBoundingClientRect().bottom : cardRect.top;
  const { clone, css, families } = await faithfulClone(card);
  const fonts = await embeddedFonts(families);
  const xml = new XMLSerializer().serializeToString(clone);
  const style = `<style xmlns="http://www.w3.org/1999/xhtml">${(fonts + "\n" + css).replace(/]]>/g, "")}</style>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cardRect.width}" height="${cardRect.height}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${style}${xml}</foreignObject></svg>`;
  const picture = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const w = cardRect.width;
  const h = Math.max(1, cardRect.bottom - top);
  const out = document.createElement("canvas");
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale);
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.scale(scale, scale);
  ctx.drawImage(picture, 0, cardRect.top - top, cardRect.width, cardRect.height);
  return toPng(out);
}

/** The artifacts card `card` shows (`data-cairn-artifact` marks), deduplicated, in page order. */
export function cardArtifacts(card: HTMLElement): Array<{ hash: string; name: string | null }> {
  const seen = new Set<string>();
  const out: Array<{ hash: string; name: string | null }> = [];
  for (const el of card.querySelectorAll<HTMLElement>("[data-cairn-artifact]")) {
    for (const hash of (el.dataset.cairnArtifact ?? "").split(",").filter(Boolean)) {
      if (seen.has(hash)) continue;
      seen.add(hash);
      out.push({ hash, name: el.dataset.cairnArtifactName || null });
    }
  }
  return out;
}

