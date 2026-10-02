/**
 * The markdown renderer every markdown surface uses (MarkdownCard for
 * `cairn.Markdown`, report cells, run notes). The parsing — GFM plus Pandoc
 * Markdown: math, footnotes, definition lists, fenced divs, spans,
 * sub/superscript, figures, … — is the shared pipeline in
 * ./markdown/pipeline.ts, which the report LaTeX export parses with too.
 *
 * Sanitization contract: raw HTML in the source is NEVER rendered as markup
 * — react-markdown's default escaping stays on (no rehype-raw plugin), so a
 * `<script>` or any other tag in the source renders as inert text. Do not
 * add rehype-raw. URLs go through the safe-protocol `urlTransform`, Pandoc
 * attribute blocks through an allowlist (./markdown/attributes.ts), and
 * KaTeX runs with `trust` off.
 *
 * Math: KaTeX is loaded lazily (./markdown-katex.ts), only for text that may
 * contain math; until it arrives, formulas show as their TeX source.
 *
 * Callouts: `> [!NOTE]` and friends (./markdown/remark-callouts.ts), and
 * pandoc fenced divs `::: note` (./markdown/remark-pandoc.ts).
 *
 * Report extras, off unless their context is provided:
 * - `headingSlugs` (line → slug) gives headings the report outline's anchor
 *   ids (without it, the text's own GitHub-style slugs), and
 *   `HeadingControlsContext` adds a collapse chevron to collapsible ones.
 * - `AssetUrlContext` resolves `cairn-asset:<hash>` image URLs (uploaded
 *   report images); without it they are dropped. Any other URL goes through
 *   react-markdown's default (safe-protocol) transform.
 */

import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Options } from "react-markdown";
import type rehypeKatex from "rehype-katex";
import { type CalloutKind } from "./markdown/remark-callouts";
import { extractHeadings } from "./markdown/headings";
import { mayContainMath, prepareMarkdown, rehypeMath, remarkPlugins, remarkRehypeOptions } from "./markdown/pipeline";
import { useReportExporting } from "./reports/export-context";

/** `cairn-asset:<sha256>` → the URL serving it, or null to drop it. */
export const AssetUrlContext = createContext<((hash: string) => string) | null>(null);

/** Collapse state of the report's headings, by slug. */
export interface HeadingControls {
  isCollapsible: (slug: string) => boolean;
  isCollapsed: (slug: string) => boolean;
  toggle: (slug: string) => void;
}
export const HeadingControlsContext = createContext<HeadingControls | null>(null);

const ASSET_URL = /^cairn-asset:([0-9a-f]{64})$/;

/** The `urlTransform`: `cairn-asset:` through `resolve`, anything else through the default. */
export function makeUrlTransform(resolve: ((hash: string) => string) | null): Options["urlTransform"] {
  return (url) => {
    const m = ASSET_URL.exec(url);
    if (m) return resolve ? resolve(m[1]!) : "";
    return defaultUrlTransform(url);
  };
}

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
const HEADING_CLASS: Record<HeadingTag, string> = {
  h1: "mt-3 mb-2 text-lg font-semibold text-fg first:mt-0",
  h2: "mt-3 mb-1.5 text-base font-semibold text-fg first:mt-0",
  h3: "mt-2 mb-1 text-sm font-semibold text-fg first:mt-0",
  h4: "mt-2 mb-1 text-sm font-semibold text-fg-muted first:mt-0",
  h5: "mt-2 mb-1 text-xs font-semibold text-fg-muted first:mt-0",
  h6: "mt-2 mb-1 text-xs font-semibold text-fg-subtle first:mt-0",
};

function Heading({ tag, node: _node, id, children, ...rest }: React.ComponentProps<"h1"> & { tag: HeadingTag; node?: unknown }) {
  const ctl = useContext(HeadingControlsContext);
  const Tag = tag;
  const collapsible = !!(id && ctl?.isCollapsible(id));
  const collapsed = collapsible && ctl!.isCollapsed(id!);
  return (
    <Tag id={id} className={`group/h relative scroll-mt-4 ${HEADING_CLASS[tag]}`} {...rest}>
      {collapsible && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            ctl!.toggle(id!);
          }}
          className={`absolute -left-5 top-1/2 -translate-y-1/2 inline-flex h-4 w-4 touch:h-8 touch:w-8 touch:-left-8 items-center justify-center rounded text-[10px] text-fg-subtle hover:bg-bg-hover hover:text-fg print:hidden ${
            collapsed ? "" : "can-hover:opacity-0 can-hover:group-hover/h:opacity-100 focus-visible:opacity-100"
          }`}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand section" : "Collapse section"}
          title={collapsed ? "Expand section" : "Collapse section"}
        >
          <i className={`fa-solid ${collapsed ? "fa-chevron-right" : "fa-chevron-down"}`} aria-hidden="true" />
        </button>
      )}
      {children}
      {collapsed && <span className="ml-2 align-middle text-[10px] font-normal text-fg-subtle">(collapsed)</span>}
    </Tag>
  );
}

const CALLOUT_STYLE: Record<CalloutKind, { label: string; icon: string; box: string; head: string }> = {
  note: { label: "Note", icon: "fa-circle-info", box: "border-accent bg-accent/5", head: "text-accent" },
  tip: { label: "Tip", icon: "fa-lightbulb", box: "border-status-completed bg-status-completed/5", head: "text-status-completed" },
  important: { label: "Important", icon: "fa-circle-exclamation", box: "border-status-stopped bg-status-stopped/5", head: "text-status-stopped" },
  warning: { label: "Warning", icon: "fa-triangle-exclamation", box: "border-status-running bg-status-running/5", head: "text-status-running" },
  caution: { label: "Caution", icon: "fa-hand", box: "border-status-failed bg-status-failed/5", head: "text-status-failed" },
};

/** A blockquote, or a callout when remark-callouts / a fenced div marked it. */
function Blockquote({ node: _node, children, ...rest }: React.ComponentProps<"blockquote"> & { node?: unknown }) {
  const props = rest as Record<string, unknown>;
  const kind = props["data-callout"] as CalloutKind | undefined;
  const style = kind ? CALLOUT_STYLE[kind] : undefined;
  if (!style) {
    return <blockquote className="my-2 border-l-2 border-border pl-3 text-fg-muted" {...rest}>{children}</blockquote>;
  }
  const fold = props["data-fold"] as string;
  const title = (props["data-title"] as string) || style.label;
  return <Callout id={rest.id} kind={kind!} style={style} title={title} fold={fold}>{children}</Callout>;
}

function Callout({
  id, kind, style, title, fold, children,
}: { id?: string; kind: CalloutKind; style: (typeof CALLOUT_STYLE)[CalloutKind]; title: string; fold: string; children: ReactNode }) {
  const [openState, setOpen] = useState(fold !== "-");
  // A report export shows folded callouts open.
  const exporting = useReportExporting();
  const open = openState || exporting;
  const head = (
    <span className={`flex items-center gap-1.5 text-xs font-semibold ${style.head}`}>
      <i className={`fa-solid ${style.icon}`} aria-hidden="true" />
      {title}
      {fold && <i className={`fa-solid ${open ? "fa-chevron-down" : "fa-chevron-right"} ml-auto text-[10px]`} aria-hidden="true" />}
    </span>
  );
  return (
    <div id={id} role="note" data-callout={kind} className={`my-2 rounded-r border-l-4 px-3 py-2 ${style.box}`}>
      {fold ? (
        <button
          type="button"
          className="block w-full text-left"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          {head}
        </button>
      ) : (
        head
      )}
      {open && <div className="text-fg [&>*:last-child]:mb-0 [&>p:first-child]:mt-1">{children}</div>}
    </div>
  );
}

const OL_STYLE: Record<string, string> = {
  "1": "list-decimal",
  a: "list-[lower-alpha]",
  A: "list-[upper-alpha]",
  i: "list-[lower-roman]",
  I: "list-[upper-roman]",
};

/** Links open in a new tab; in-page anchors (`#id`: headings, footnotes) scroll instead. */
function Anchor({ node: _node, href, ...p }: React.ComponentProps<"a"> & { node?: unknown }) {
  if (href?.startsWith("#")) {
    return (
      <a
        className="text-accent hover:underline"
        href={href}
        {...p}
        onClick={(e) => {
          const el = document.getElementById(decodeURIComponent(href.slice(1)));
          if (!el) return;
          e.preventDefault();
          e.stopPropagation();
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }}
      />
    );
  }
  return <a className="text-accent hover:underline" target="_blank" rel="noreferrer noopener" href={href} {...p} />;
}

function hasClass(className: string | undefined, c: string): boolean {
  return !!className && className.split(" ").includes(c);
}

/** Fenced divs, line blocks, macro blocks (hidden). */
function Div({ node: _node, className, ...p }: React.ComponentProps<"div"> & { node?: unknown }) {
  if (hasClass(className, "line-block")) return <div className="line-block my-1.5 leading-relaxed text-fg" {...p} />;
  return <div className={className} {...p} />;
}

/** Bracketed spans, citations, small caps. */
function Span({ node: _node, className, ...p }: React.ComponentProps<"span"> & { node?: unknown }) {
  if (hasClass(className, "citation")) return <span className="citation rounded bg-bg-hover px-1 text-[0.9em] text-fg-muted" {...p} />;
  if (hasClass(className, "smallcaps")) return <span className={`[font-variant:small-caps] ${className}`} {...p} />;
  return <span className={className} {...p} />;
}

/** `components` override map for react-markdown — theme tokens, no raw HTML. */
export const MD_COMPONENTS = {
  h1: (p: React.ComponentProps<"h1">) => <Heading tag="h1" {...p} />,
  h2: (p: React.ComponentProps<"h2">) => <Heading tag="h2" {...p} />,
  h3: (p: React.ComponentProps<"h3">) => <Heading tag="h3" {...p} />,
  h4: (p: React.ComponentProps<"h4">) => <Heading tag="h4" {...p} />,
  h5: (p: React.ComponentProps<"h5">) => <Heading tag="h5" {...p} />,
  h6: (p: React.ComponentProps<"h6">) => <Heading tag="h6" {...p} />,
  p: (p: React.ComponentProps<"p">) => <p className="my-1.5 leading-relaxed text-fg" {...p} />,
  a: Anchor,
  ul: (p: React.ComponentProps<"ul">) => <ul className="my-1.5 ml-5 list-disc space-y-0.5" {...p} />,
  ol: ({ node: _node, type, ...p }: React.ComponentProps<"ol"> & { node?: unknown }) => (
    <ol className={`my-1.5 ml-5 space-y-0.5 ${OL_STYLE[type ?? "1"] ?? "list-decimal"}`} type={type} {...p} />
  ),
  li: (p: React.ComponentProps<"li">) => <li className="text-fg" {...p} />,
  blockquote: Blockquote,
  img: ({ node: _node, alt, className: _c, ...p }: React.ComponentProps<"img"> & { node?: unknown }) => (
    <img {...p} alt={alt ?? ""} loading="lazy" className="my-2 inline-block max-w-full rounded" />
  ),
  figure: (p: React.ComponentProps<"figure">) => <figure className="my-2 flex flex-col items-center [&>img]:my-0" {...p} />,
  figcaption: (p: React.ComponentProps<"figcaption">) => (
    <figcaption className="mt-1 text-center text-[0.9em] text-fg-muted" {...p} />
  ),
  sup: (p: React.ComponentProps<"sup">) => <sup className="[&>a]:no-underline" {...p} />,
  dl: (p: React.ComponentProps<"dl">) => <dl className="my-1.5" {...p} />,
  dt: (p: React.ComponentProps<"dt">) => <dt className="font-semibold text-fg" {...p} />,
  dd: (p: React.ComponentProps<"dd">) => <dd className="mb-1.5 ml-5 text-fg [&>p]:my-0.5" {...p} />,
  section: ({ node: _node, className, ...p }: React.ComponentProps<"section"> & { node?: unknown }) => (
    // GFM footnotes: the only section markdown produces.
    <section className={`${className ?? ""} mt-3 border-t border-border pt-1 text-[0.85em] text-fg-muted [&_li>p]:my-0.5`} {...p} />
  ),
  div: Div,
  span: Span,
  mark: (p: React.ComponentProps<"mark">) => <mark className="rounded-sm bg-status-running/25 px-0.5 text-fg" {...p} />,
  hr: (p: React.ComponentProps<"hr">) => <hr className="my-3 border-border" {...p} />,
  strong: (p: React.ComponentProps<"strong">) => <strong className="font-semibold text-fg" {...p} />,
  em: (p: React.ComponentProps<"em">) => <em className="italic" {...p} />,
  del: (p: React.ComponentProps<"del">) => <del className="text-fg-subtle" {...p} />,
  code: (p: React.ComponentProps<"code">) => (
    <code className="mono rounded bg-bg-hover px-1 py-0.5 text-[0.85em] text-fg" {...p} />
  ),
  pre: (p: React.ComponentProps<"pre">) => (
    <pre
      className="mono my-2 overflow-auto rounded bg-bg p-3 text-xs text-fg-muted [&>code]:rounded-none [&>code]:bg-transparent [&>code]:p-0"
      {...p}
    />
  ),
  table: (p: React.ComponentProps<"table">) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs" {...p} />
    </div>
  ),
  thead: (p: React.ComponentProps<"thead">) => <thead className="bg-bg-hover" {...p} />,
  th: (p: React.ComponentProps<"th">) => (
    <th className="border border-border px-2 py-1 text-left font-semibold text-fg" {...p} />
  ),
  td: (p: React.ComponentProps<"td">) => <td className="border border-border px-2 py-1 text-fg-muted" {...p} />,
  input: (p: React.ComponentProps<"input">) => (
    <input {...p} disabled className="mr-1 accent-accent align-middle" />
  ),
};

let katexPlugin: typeof rehypeKatex | null = null;
let katexLoading: Promise<typeof rehypeKatex> | null = null;

/** rehype-katex once `needed` (loading it on first use), else null. */
function useKatex(needed: boolean): typeof rehypeKatex | null {
  const [plugin, setPlugin] = useState(() => katexPlugin);
  useEffect(() => {
    if (!needed || plugin) return;
    let live = true;
    katexLoading ??= import("./markdown-katex").then((m) => (katexPlugin = m.default));
    void katexLoading.then((p) => live && setPlugin(() => p));
    return () => {
      live = false;
    };
  }, [needed, plugin]);
  return needed ? plugin : null;
}

/**
 * Render markdown text (GFM + Pandoc, see ./markdown/pipeline.ts) with the
 * shared theme + sanitization contract. Renders no wrapper element of its
 * own, so call sites control the layout.
 */
export default function Markdown({
  children,
  headingSlugs,
}: {
  children: string;
  /** 0-based source line → anchor id for the text's headings (see lib/reports/outline.ts). */
  headingSlugs?: ReadonlyMap<number, string>;
}) {
  const resolveAsset = useContext(AssetUrlContext);
  const urlTransform = useMemo(() => makeUrlTransform(resolveAsset), [resolveAsset]);
  const slugs = useMemo(
    () => headingSlugs ?? new Map(extractHeadings(children).map((h) => [h.line, h.slug])),
    [headingSlugs, children],
  );
  const remark = useMemo(() => remarkPlugins({ headingSlugs: slugs }), [slugs]);
  // Footnote ids unique per text: several texts share a page.
  const uid = useId().replace(/[^\w-]/g, "");
  const toHast = useMemo(() => remarkRehypeOptions(`md${uid}-`), [uid]);
  const katex = useKatex(mayContainMath(children));
  const rehype = useMemo<Options["rehypePlugins"]>(() => (katex ? [rehypeMath(katex)] : []), [katex]);
  const source = useMemo(() => prepareMarkdown(children), [children]);
  return (
    <ReactMarkdown
      remarkPlugins={remark}
      remarkRehypeOptions={toHast}
      rehypePlugins={rehype}
      components={MD_COMPONENTS}
      urlTransform={urlTransform}
    >
      {source}
    </ReactMarkdown>
  );
}
