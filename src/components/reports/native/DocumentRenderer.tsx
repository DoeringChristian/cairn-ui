import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { resolveReferences, repairAnchorTargets } from "./references";
import { copyText, reportReference, blockReference, type ReferenceBlock, type SourceLocation } from "./clipboard";
import { InlineReportEditor } from "./InlineReportEditor";
import { ReportComments } from "./ReportComments";
import { locateTextSelection, type TextSelection } from "./textSelection";
import { ReportSelectionTools } from "./ReportSelectionTools";
import { ReportReferenceActions } from "./ReportReferenceActions";
import { TITLE_TARGET, DESCRIPTION_TARGET, isReportHeading, loadHeadingSources, projectSource, referenceBlock, type HeadingSources } from "./document-sources";
import { CapturedCard, type CapturedCardSpec } from "./CapturedCard";
import { createPortal } from "react-dom";
import { ReportPlot, type ReportFigure } from "./ReportPlot";
import { VideoPreview, InlineVideoControls } from "./media/VideoPreview";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import DOMPurify from "dompurify";
import "katex/dist/katex.min.css";
import {
  Expand,
} from "lucide-react";


function Callout({children}: {children: React.ReactNode; error?: boolean}) { return <aside className="document-callout">{children}</aside>; }
import "./document.css";



import { MediaLightbox, type MediaItem } from "./MediaLightbox";


export type Output = {
  type: string;
  name?: string;
  text?: string;
  message?: string;
  data?: Record<string, unknown>;
};
export type Block = {
  spec?: CapturedCardSpec;

  id: string;
  label?: string;
  type: string;
  source?: SourceLocation;
  markdown?: string;
  code?: string;
  language?: string;
  echo?: boolean;
  caption?: string;
  outputs?: Output[];
};
type Asset = { hash: string; size: number; mime: string; path: string };
type Reference = {
  title?: string;
  author?: string;
  year?: string | number;
  url?: string;
};
export type DocumentDefinition = HeadingSources & {
  schema: string;
  publication?: ReturnType<typeof reportReference>;
  baseUrl?: string;
  rendered_ref?: string;
  title: string;
  description?: string;
  source_ref: string;
  environment_ref?: string;
  environment_hash?: string;
  blocks: Block[];
  references?: Record<string, Reference>;
  citations?: string[];
  assets?: Record<string, Asset>;
  inputs?: Record<string, { ref: string }>;
};
export const DocumentContext = createContext<DocumentDefinition | null>(null);
const BlockContext=createContext<Block|null>(null);
const ReportMediaContext = createContext<((item: MediaItem) => void) | null>(
  null,
);

function Media({
  src = "",
  alt = "",
  video = false,
  audio = false,
}: {
  src?: string;
  alt?: string;
  video?: boolean;
  audio?: boolean;
}) {
  const document = useContext(DocumentContext);
  const block=useContext(BlockContext);
  const inlineVideo = useRef<HTMLVideoElement>(null);
  const openMedia = useContext(ReportMediaContext);
  const asset = document?.assets?.[src.replace(/^\.\//, "")];
  const [expanded, setExpanded] = useState(false);
  const safe = asset?.path ? new URL(asset.path, document?.baseUrl || window.location.href).href
    : /^(https?:|data:image\/)/.test(src) ? src : "";

  if (!safe)
    return (
      <span className="document-media-pending">
        {asset ? "Loading media…" : `Media unavailable: ${alt || src}`}
      </span>
    );
  if (audio)
    return (
      <audio
        src={safe}
        controls
        preload="metadata"
        aria-label={alt || "Report audio"}
      />
    );
  const mime =
    asset?.mime ||
    (video ? "video/mp4" : src.match(/^data:([^;,]+)/)?.[1] || "image/png");
  const item: MediaItem = {
    url: safe,
    mime,
    time: inlineVideo.current?.currentTime,
    name: alt || src || "Report media",
    source: {
      ...document?.publication, block_id:block?.id, source:block?.source,
      report_ref: document?.rendered_ref || document?.source_ref,
      path: asset ? src : undefined,
    },
  };
  const open = () => {
    inlineVideo.current?.pause();
    item.time = inlineVideo.current?.currentTime;
    return openMedia ? openMedia(item) : setExpanded(true);
  };
  if (video)
    return (
      <span className="document-media-wrap">
        <VideoPreview src={safe} mime={mime} label={alt || "Report video"} videoRef={inlineVideo} videoClassName="document-media" reportPath={asset ? src : undefined} onEnlarge={open} />
        {expanded && (
          <MediaLightbox items={[item]} onClose={() => setExpanded(false)} />
        )}
      </span>
    );
  return (
    <span className="document-media-wrap">
      <button
        className="document-image-button"
        onClick={open}
        title="Enlarge image"
      >
        <img
          data-report-media={mime}
          data-report-path={asset ? src : undefined}
          className="document-image"
          src={safe}
          alt={alt}
          loading="lazy"
          style={{ minHeight: 120, width: "100%" }}
        />
        <span>
          <Expand size={14} /> Enlarge
        </span>
      </button>
      {expanded && (
        <MediaLightbox items={[item]} onClose={() => setExpanded(false)} />
      )}
    </span>
  );
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const document = useContext(DocumentContext);
  const referencesPlugin = () => (tree: Parameters<typeof resolveReferences>[0]) => resolveReferences(tree, document?.references || {}, document?.blocks || [], document?.citations);
  const prose = text;
  const directive = /^:::\s*\{?\.?([\w-]+)\}?\s*\n([\s\S]*?)\n:::\s*$/gm;
  const parts: { text: string; kind?: string }[] = [];
  let start = 0;
  for (const match of prose.matchAll(directive)) {
    if (match.index! > start)
      parts.push({ text: prose.slice(start, match.index) });
    parts.push({ text: match[2], kind: match[1] });
    start = match.index! + match[0].length;
  }
  parts.push({ text: prose.slice(start) });
  const render = (value: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, referencesPlugin]}
      rehypePlugins={[
        rehypeRaw,
        [
          rehypeSanitize,
          {
            ...defaultSchema,
            tagNames: [...(defaultSchema.tagNames || []), "video", "audio"],
            attributes: {
              ...defaultSchema.attributes,
              video: ["src", "controls", "poster", "preload"],
              audio: ["src", "controls", "preload"],
            },
          },
        ],
        () => repairAnchorTargets,
        rehypeKatex,
      ]}
      urlTransform={defaultUrlTransform}
      components={{
        img: ({ src, alt }) => <Media src={src} alt={alt} />,
        video: ({ src }) => <Media src={src} video />,
        audio: ({ src }) => <Media src={src} audio />,
        a: ({ node, href, children, ...props }) => (
          <a
            {...props}
            href={href}
            className={node?.properties.dataFootnoteBackref !== undefined ? "document-footnote-return" : props.className}
            rel={href?.startsWith("http") ? "noreferrer" : undefined}
          >
            {node?.properties.dataFootnoteBackref !== undefined ? "Back to text" : children}
          </a>
        ),
      }}
    >
      {value}
    </ReactMarkdown>
  );
  return (
    <>
      {parts.map((part, i) =>
        part.kind === "gallery" ? (
          <div key={i} className="document-gallery">
            {render(part.text)}
          </div>
        ) : part.kind ? (
          <aside key={i} className={`document-callout ${part.kind}`}>
            <span className="callout-title">
              {part.kind.replace(/-/g, " ")}
            </span>
            {render(part.text)}
          </aside>
        ) : (
          <div key={i}>{render(part.text)}</div>
        ),
      )}
    </>
  );
});

export function SafeHtml({ html }: { html: string }) {
  const content = useRef<HTMLDivElement>(null),
    definition = useContext(DocumentContext),
    block=useContext(BlockContext),
    openMedia = useContext(ReportMediaContext);
  const [videos, setVideos] = useState<
      { element: HTMLVideoElement; anchor: HTMLSpanElement }[]
    >([]),
    [expanded, setExpanded] = useState<MediaItem | null>(null);
  const sanitized = useMemo(
    () =>
      DOMPurify.sanitize(html, {
        FORBID_TAGS: ["style", "iframe", "form", "input", "button"],
        FORBID_ATTR: ["style"],
        ADD_TAGS: ["math", "semantics", "annotation"],
      }),
    [html],
  );
  useEffect(() => {
    for (const element of content.current?.querySelectorAll("[src]") || []) {
      const source = element.getAttribute("src") || "";
      const asset = definition?.assets?.[source.replace(/^\.\//, "")];
      if (asset?.path) element.setAttribute("src", new URL(asset.path, definition?.baseUrl).href);
    }
    for (const image of content.current?.querySelectorAll("img") || []) image.dataset.reportMedia = "image/png";
    const nodes = [...(content.current?.querySelectorAll("video") || [])].map(
      (element) => {
        const anchor = window.document.createElement("span");
        anchor.dataset.selectionIgnore = "";
        element.after(anchor);
        element.controls = false;
        element.playsInline = true;
        element.dataset.reportMedia =
          element.querySelector("source")?.type || "video/mp4";
        return { element, anchor };
      },
    );
    setVideos(nodes);
    return () => nodes.forEach(({ anchor }) => anchor.remove());
  }, [sanitized]);
  const open = (element: HTMLVideoElement) => {
    element.pause();
    const item: MediaItem = {
      url: element.currentSrc || element.src,
      mime: element.dataset.reportMedia || "video/mp4",
      name: element.getAttribute("aria-label") || "Report video",
      time: element.currentTime,
      source: {
        ...definition?.publication,block_id:block?.id,source:block?.source,
        report_ref: definition?.rendered_ref || definition?.source_ref,
      },
    };
    if (openMedia) openMedia(item);
    else setExpanded(item);
  };
  return (
    <>
      <div
        ref={content}
        className="document-html"
        onClick={event => {
          const element = event.target;
          if (!(element instanceof HTMLImageElement)) return;
          const item: MediaItem = {url: element.src, mime: "image/png", name: element.alt || "Report figure", source: {...definition?.publication,block_id:block?.id,source:block?.source,report_ref: definition?.rendered_ref || definition?.source_ref}};
          if (openMedia) openMedia(item); else setExpanded(item);
        }}
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
      {videos.map(({ element, anchor }, index) =>
        createPortal(
          <InlineVideoControls element={element} onEnlarge={() => open(element)} label={element.getAttribute("aria-label") || "Report video"} />,
          anchor,
          String(index),
        ),
      )}
      {expanded && (
        <MediaLightbox items={[expanded]} onClose={() => setExpanded(null)} />
      )}
    </>
  );
}
export function OutputView({ output, onCopySource, onComment, onEditSource }: { output: Output; onCopySource?: () => void; onComment?: () => void; onEditSource?: () => void }) {
  if (output.type === "stream")
    return (
      <pre
        className={`document-output ${output.name === "stderr" ? "stderr" : ""}`}
      >
        {output.text}
      </pre>
    );
  if (output.type === "error")
    return (
      <Callout error>
        {output.name}: {output.message}
      </Callout>
    );
  const data = output.data || {};
  const content = (mime: string) =>
    Array.isArray(data[mime])
      ? (data[mime] as string[]).join("")
      : String(data[mime] || "");
  if (data["application/vnd.plotly.v1+json"]) return <ReportPlot figure={data["application/vnd.plotly.v1+json"] as ReportFigure} onCopySource={onCopySource} onComment={onComment} onEditSource={onEditSource} />;
  if (data["image/png"] || data["image/jpeg"]) {
    const mime = data["image/png"] ? "image/png" : "image/jpeg";
    return (
      <Media
        src={`data:${mime};base64,${content(mime)}`}
        alt="Executed cell output"
      />
    );
  }
  if (data["image/svg+xml"])
    return (
      <Media
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(DOMPurify.sanitize(content("image/svg+xml"), { USE_PROFILES: { svg: true, svgFilters: true } }))}`}
        alt="Executed cell figure"
      />
    );
  if (data["text/html"]) return <SafeHtml html={content("text/html")} />;
  if (data["text/markdown"])
    return <Markdown text={content("text/markdown")} />;
  if (data["text/latex"])
    return (
      <Markdown
        text={`$$\n${content("text/latex").replace(/^\$+|\$+$/g, "")}\n$$`}
      />
    );
  if (data["application/json"])
    return (
      <pre className="document-output">
        {JSON.stringify(data["application/json"], null, 2)}
      </pre>
    );
  if (data["text/plain"])
    return <pre className="document-output">{content("text/plain")}</pre>;
  return (
    <Callout>
      Unsupported display output: {Object.keys(data).join(", ")}. The original
      is retained in the executed notebook.
    </Callout>
  );
}


/** Read-only native report, with evidence references and media inspection. */
export function DocumentRenderer({url, reportSlug, projectId, reportId, versionId, showSource=false}: {url: string; reportSlug: string; fallbackUrl: string; title: string; projectId: string; reportId: string; versionId: string; showSource?:boolean}) {
  const [definition, setDefinition] = useState<DocumentDefinition | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState("");
  const [comment, setComment] = useState<{blockId: string | null; selection?: TextSelection} | null>(null);
  const [selected, setSelected] = useState<Block | null>(null);
  const article = useRef<HTMLElement>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [copyFailure, setCopyFailure] = useState<{message:string;text:string}|null>(null);
  const [media, setMedia] = useState<{items: MediaItem[]; index: number} | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setDefinition(null); setEditing(null); setSelected(null); setMedia(null); setComment(null); setError("");
    fetch(url, {signal: controller.signal}).then(async response => {
      if (response.status === 404) throw new Error("This publication has no native document. Rebuild its source to publish one.");
      if (!response.ok) throw new Error(`Could not load document (${response.status})`);
      const text = await response.text();
      if (text.length > 30 * 1024 * 1024) throw new Error("Document exceeds the interactive size limit.");
      const parsed = JSON.parse(text) as DocumentDefinition;
      if (parsed.schema !== "cairn.document/v1" || !Array.isArray(parsed.blocks)) throw new Error("Unsupported report document schema.");
      const headingSources = await loadHeadingSources(parsed, new URL(url, window.location.href).href, controller.signal);
      if (controller.signal.aborted) return;
      const link=new URL(window.location.href);link.search="";link.searchParams.set("version",versionId);link.hash="";
      // Source bundles are relative to their report directory; client projects and
      // server workspaces both place that directory at reports/<slug>. Keep the
      // bundle path for source inspection and the project path for copied refs.
      const blocks=parsed.blocks.map(block=>({...block,source:projectSource(block.source,reportSlug)}));
      setDefinition({...parsed, blocks,
        title_source:projectSource(parsed.title_source || headingSources.title_source,reportSlug),
        description_source:projectSource(parsed.description_source || headingSources.description_source,reportSlug),
        publication:reportReference(reportId,versionId,link.href,parsed.source_ref), rendered_ref: `${reportId}@${versionId}`, baseUrl: new URL(".", new URL(url, window.location.href)).href});
    }).catch(error => {if (!controller.signal.aborted) setError(error.message);});
    return () => controller.abort();
  }, [url, reportSlug, reportId, versionId]);
  useEffect(() => {
    if(!definition)return;
    const scroll=()=>{let id:string;try{id=decodeURIComponent(window.location.hash.slice(1));}catch{return;}if(id)document.getElementById(id)?.scrollIntoView({block:"start"});};
    const frame=requestAnimationFrame(scroll);
    window.addEventListener("hashchange",scroll);
    return ()=>{cancelAnimationFrame(frame);window.removeEventListener("hashchange",scroll);};
  },[definition]);
  const copy = async (block: ReferenceBlock) => {
    let reference="";
    try {
      if(!definition?.publication)throw new Error("Publication reference is unavailable");
      reference=blockReference(definition.publication,block);
      await copyText(reference);
      setCopyFailure(null);
      setCopied(block.id);
      setTimeout(() => setCopied(""), 1800);
    } catch(cause) { setCopyFailure({message:String(cause),text:reference}); }
  };
  const locate = (selection: TextSelection) => {
    const range = article.current && locateTextSelection(article.current, selection);
    if (!range) {setSelectionError("This passage cannot be located in the current rendering. Its saved quotation remains available."); return;}
    range.startContainer.parentElement?.scrollIntoView({block: "center", behavior: "smooth"});
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
  };
  const openMedia = (item: MediaItem) => {
    const items: MediaItem[] = [];
    article.current?.querySelectorAll<HTMLImageElement | HTMLVideoElement>("[data-report-media]").forEach(node => {
      if (!node.src || items.some(existing => existing.url === node.src)) return;
      items.push({url: node.src, mime: node.dataset.reportMedia!, name: node instanceof HTMLImageElement ? node.alt : node.getAttribute("aria-label") || undefined, source: {...definition?.publication,block_id:node.closest("[data-report-text]")?.getAttribute("data-report-text") || undefined,report_ref: definition?.rendered_ref, path: node.dataset.reportPath}});
    });
    const index = items.findIndex(existing => existing.url === item.url);
    if (index >= 0) items[index] = item;
    setMedia(index >= 0 ? {items, index} : {items: [item], index: 0});
  };
  if (error) return <p role="alert">{error}</p>;
  if (!definition) return <p>Loading report…</p>;
  const tools = (block: ReferenceBlock, onEdit?: () => void) => <div className="report-block-tools" data-selection-ignore role="toolbar" aria-label="Report block actions">
    <ReportReferenceActions copied={copied === block.id} canCopy={!!block.source} onCopy={() => void copy(block)} onComment={() => setComment({blockId:isReportHeading(block.id) ? null : block.id})} onEdit={onEdit} />
  </div>;
  return <DocumentContext.Provider value={definition}><ReportMediaContext.Provider value={openMedia}>
    <div className="native-document-shell">
    {selectionError && <p role="status">{selectionError}</p>}
    {copied && <div className="report-copy-status" role="status">Report reference copied.</div>}
    {copyFailure && <div className="report-copy-fallback" role="status"><p>{copyFailure.message}</p><textarea readOnly aria-label="Reference to copy" value={copyFailure.text} onFocus={event=>event.currentTarget.select()}/><button onClick={()=>setCopyFailure(null)}>Close</button></div>}
    <article ref={article} className={`native-document ${showSource ? "with-source" : ""}`}>
      <header className="document-heading">
        <div className="report-reference-target" data-report-text={TITLE_TARGET}>{tools(referenceBlock(definition,TITLE_TARGET)!)}<h1>{definition.title}</h1></div>
        {definition.description && <div className="report-reference-target" data-report-text={DESCRIPTION_TARGET}>{tools(referenceBlock(definition,DESCRIPTION_TARGET)!)}<p>{definition.description}</p></div>}
        {comment?.blockId === null && <ReportComments key={`${versionId}:report`} projectId={projectId} reportId={reportId} versionId={versionId} blockId={null} onLocate={locate} onClose={() => setComment(null)} />}
      </header>
      {definition.blocks.filter(block => block.type === "card" || !!block.markdown?.replace(/<!--[\s\S]*?-->/g, "").trim() || (block.code !== undefined && (block.echo !== false || showSource)) || !!block.outputs?.length).map(block => <BlockContext.Provider value={block} key={block.id}><section className="document-block" id={block.label || block.id} data-report-text={block.id}>{block.label && block.label !== block.id && <span id={block.id} aria-hidden="true"/>}
        {showSource && <button className="document-source-label" onClick={() => setSelected(block)}>{block.source ? `${block.source.file}:${block.source.line}` : block.id}</button>}
        {block.type !== "card" && tools(block,block.source ? () => setEditing(block.id) : undefined)}
        {editing === block.id && <InlineReportEditor key={`${versionId}:${block.id}`} reportId={reportId} versionId={versionId} blockId={block.id} onClose={() => setEditing(null)} />}
        {block.type === "card" && block.spec && <CapturedCard spec={block.spec} onEditSource={block.source ? () => setEditing(block.id) : undefined} onCopySource={() => void copy(block)} onComment={() => setComment({blockId:block.id})} />}
        {block.markdown !== undefined && <Markdown text={block.markdown} />}
        {block.code !== undefined && (block.echo !== false || showSource) && <details open={block.echo !== false} className="document-code"><summary>{block.language || "Code"}{block.source && ` · ${block.source.file}:${block.source.line}`}</summary><pre><code>{block.code}</code></pre></details>}
        {block.outputs?.map((output, i) => <OutputView key={i} output={output} onCopySource={() => void copy(block)} onComment={() => setComment({blockId:block.id})} onEditSource={block.source ? () => setEditing(block.id) : undefined} />)}
        {comment?.blockId === block.id && <ReportComments projectId={projectId} reportId={reportId} versionId={versionId} blockId={block.id} selection={comment.selection} onLocate={locate} onClose={() => setComment(null)} />}
        {block.caption && <p className="document-caption">{block.caption}</p>}
      </section></BlockContext.Provider>)}
      {!!Object.keys(definition.references || {}).length && <section className="document-bibliography"><h2>References</h2><ol>{(definition.citations || Object.keys(definition.references || {})).filter(key => definition.references?.[key]).map(key => {const reference = definition.references![key]!; return <li key={key} id={`ref-${key}`}>{reference.author} {reference.year && `(${reference.year}). `}{reference.url ? <a href={defaultUrlTransform(reference.url)} rel="noreferrer">{reference.title}</a> : reference.title}</li>;})}</ol></section>}
    </article>
    <ReportSelectionTools root={article} definition={definition} renderedRef={`${reportId}@${versionId}`} onComment={selection => setComment(isReportHeading(selection.start.block_id) ? {blockId:null} : {blockId: selection.start.block_id, selection})} />
    {selected && <aside className="document-source-inspector"><header><strong>{selected.source?.file || "Source"}:{selected.source?.line || 1}</strong><button onClick={() => setSelected(null)} aria-label="Close source">×</button></header><pre><code>{selected.markdown ?? selected.code ?? JSON.stringify(selected.spec, null, 2)}</code></pre><div role="toolbar" aria-label="Source actions"><ReportReferenceActions copied={copied === selected.id} canCopy={!!selected.source} onCopy={() => void copy(selected)} onComment={() => {setComment({blockId:selected.id}); setSelected(null);}} /></div></aside>}</div>
    {media && <MediaLightbox items={media.items} initialIndex={media.index} onClose={() => setMedia(null)} />}
  </ReportMediaContext.Provider></DocumentContext.Provider>;
}
