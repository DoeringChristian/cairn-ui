/**
 * Shared GitHub-flavored markdown rendering surface.
 *
 * Sanitization contract: raw HTML in the source is NEVER rendered as markup
 * — react-markdown's default escaping stays on (no rehype-raw plugin), so a
 * `<script>` or any other tag in the source renders as inert text. Do not
 * add rehype-raw.
 *
 * Shared by MarkdownCard (run-logged markdown blobs) and report markdown
 * cells so both surfaces render GFM identically.
 *
 * Math: text containing `$$` renders through the lazy KaTeX chunk
 * (./markdown-math.tsx). Inline math is `$$…$$` inside a line, display math
 * is `$$` on its own lines; a single `$` stays a dollar sign.
 *
 * Callouts: `> [!NOTE]` and friends (./markdown/remark-callouts.ts).
 *
 * Report extras, off unless their context is provided:
 * - `headingSlugs` (line → slug) gives headings their anchor ids, and
 *   `HeadingControlsContext` adds a collapse chevron to collapsible ones.
 * - `AssetUrlContext` resolves `cairn-asset:<hash>` image URLs (uploaded
 *   report images); without it they are dropped. Any other URL goes through
 *   react-markdown's default (safe-protocol) transform.
 */

import { createContext, lazy, Suspense, useContext, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkCallouts, { type CalloutKind } from "./markdown/remark-callouts";
import remarkHeadingIds from "./markdown/heading-ids";
import { useReportExporting } from "./reports/export-context";

const MathMarkdown = lazy(() => import("./markdown-math"));

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

/** A blockquote, or a callout when remark-callouts marked it. */
function Blockquote({ node: _node, children, ...rest }: React.ComponentProps<"blockquote"> & { node?: unknown }) {
  const props = rest as Record<string, unknown>;
  const kind = props["data-callout"] as CalloutKind | undefined;
  const style = kind ? CALLOUT_STYLE[kind] : undefined;
  if (!style) {
    return <blockquote className="my-2 border-l-2 border-border pl-3 text-fg-muted" {...rest}>{children}</blockquote>;
  }
  const fold = props["data-fold"] as string;
  const title = (props["data-title"] as string) || style.label;
  return <Callout kind={kind!} style={style} title={title} fold={fold}>{children}</Callout>;
}

function Callout({
  kind, style, title, fold, children,
}: { kind: CalloutKind; style: (typeof CALLOUT_STYLE)[CalloutKind]; title: string; fold: string; children: ReactNode }) {
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
    <div role="note" data-callout={kind} className={`my-2 rounded-r border-l-4 px-3 py-2 ${style.box}`}>
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

/** `components` override map for react-markdown — theme tokens, no raw HTML. */
export const MD_COMPONENTS = {
  h1: (p: React.ComponentProps<"h1">) => <Heading tag="h1" {...p} />,
  h2: (p: React.ComponentProps<"h2">) => <Heading tag="h2" {...p} />,
  h3: (p: React.ComponentProps<"h3">) => <Heading tag="h3" {...p} />,
  h4: (p: React.ComponentProps<"h4">) => <Heading tag="h4" {...p} />,
  h5: (p: React.ComponentProps<"h5">) => <Heading tag="h5" {...p} />,
  h6: (p: React.ComponentProps<"h6">) => <Heading tag="h6" {...p} />,
  p: (p: React.ComponentProps<"p">) => <p className="my-1.5 leading-relaxed text-fg" {...p} />,
  a: (p: React.ComponentProps<"a">) => <a className="text-accent hover:underline" target="_blank" rel="noreferrer noopener" {...p} />,
  ul: (p: React.ComponentProps<"ul">) => <ul className="my-1.5 ml-5 list-disc space-y-0.5" {...p} />,
  ol: (p: React.ComponentProps<"ol">) => <ol className="my-1.5 ml-5 list-decimal space-y-0.5" {...p} />,
  li: (p: React.ComponentProps<"li">) => <li className="text-fg" {...p} />,
  blockquote: Blockquote,
  img: ({ node: _node, alt, ...p }: React.ComponentProps<"img"> & { node?: unknown }) => (
    <img {...p} alt={alt ?? ""} loading="lazy" className="my-2 inline-block max-w-full rounded" />
  ),
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

/**
 * Render GFM markdown text with the shared theme + sanitization contract.
 * Renders no wrapper element of its own, so call sites control the layout.
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
  const remarkPlugins = useMemo<NonNullable<Options["remarkPlugins"]>>(
    () => [remarkGfm, remarkCallouts, ...(headingSlugs?.size ? [[remarkHeadingIds, headingSlugs] as [typeof remarkHeadingIds, ReadonlyMap<number, string>]] : [])],
    [headingSlugs],
  );
  const plain = (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={MD_COMPONENTS} urlTransform={urlTransform}>
      {children}
    </ReactMarkdown>
  );
  if (!children.includes("$$")) return plain;
  // Until the KaTeX chunk loads, show the source text rather than nothing.
  return (
    <Suspense fallback={plain}>
      <MathMarkdown remarkPlugins={remarkPlugins} urlTransform={urlTransform}>{children}</MathMarkdown>
    </Suspense>
  );
}
