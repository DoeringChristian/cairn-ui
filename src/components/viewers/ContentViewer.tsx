/**
 * The one dispatch from a piece of content to its viewer, used by every
 * surface that shows stored content outside a card: an artifact version's
 * files, the artifact card, a table's enlarged media cell. Each kind renders
 * with the very component its card renders it with (see lib/viewers/kind.ts
 * for how the kind is decided):
 *
 * image → ImageViewer (the image card's zoomable pane), video → VideoViewer
 * (the video card's clocked player), audio → AudioViewer, markdown →
 * MarkdownViewer, html → HtmlViewer (sandboxed), table → TableViewer (the
 * table card's grid and query bar), figure → FigureViewer, point cloud /
 * mesh / 3D boxes → Scene3DViewer, tensor → TensorViewer, JSON → JsonViewer
 * (figure / table / the JSON tree), text and code → TextViewer.
 *
 * Heavy viewers (Plotly, three.js, the markdown pipeline) load on demand.
 */

import { lazy, Suspense, useState, type ReactNode } from "react";
import { langFromPath } from "../../lib/syntax-highlight";
import { tableFormat, viewerKind, type ViewerKind } from "../../lib/viewers/kind";
import type { ViewerSource } from "../../lib/viewers/source";
import UnsupportedArtifact from "../UnsupportedArtifact";
import AudioViewer from "./AudioViewer";
import HtmlViewer from "./HtmlViewer";
import ImageViewer from "./ImageViewer";
import PickleInfo from "./PickleInfo";
import TextViewer from "./TextViewer";
import { ViewerLoading } from "./use-viewer-text";
import VideoViewer from "./VideoViewer";
import ViewModeSwitch from "./ViewModeSwitch";

const MarkdownViewer = lazy(() => import("./MarkdownViewer"));
const TableViewer = lazy(() => import("./TableViewer"));
const JsonViewer = lazy(() => import("./JsonViewer"));
const FigureViewer = lazy(() => import("./FigureViewer"));
const Scene3DViewer = lazy(() => import("./Scene3DViewer"));
const NpzViewer = lazy(() => import("./NpzViewer"));
const TensorViewer = lazy(() => import("./TensorViewer"));

/** Text-like viewers read at most this much of a file (its head, by a Range request). */
export const VIEWER_TEXT_BYTES = 256 * 1024;

/** Kinds that can also be read as their source text. */
const SOURCE_LANG: Partial<Record<ViewerKind, string>> = { markdown: "markdown", html: "html" };

export interface ContentViewerProps {
  source: ViewerSource;
  /** Decided from the source (its logged type, mime, name) when omitted. */
  kind?: ViewerKind;
  /** Fill the parent's height (a card body); otherwise media take a viewport-relative height. */
  fill?: boolean;
  /**
   * Python that loads this content (`art.get("model.pkl")`): offered where the
   * browser cannot show it (a pickle, an unknown binary).
   */
  loadSnippet?: string;
  /** Text-like kinds: read at most this many bytes (default VIEWER_TEXT_BYTES). */
  maxBytes?: number;
}

export default function ContentViewer({ source, kind: given, fill = false, loadSnippet, maxBytes = VIEWER_TEXT_BYTES }: ContentViewerProps) {
  const kind = given ?? viewerKind({ path: source.name, mime: source.mime, object_type: source.objectType });
  const [asSource, setAsSource] = useState(false);
  const lang = SOURCE_LANG[kind];
  const media = (child: ReactNode) => (
    <div className={fill ? "h-full min-h-0 w-full" : "h-[60vh] min-h-[16rem] w-full"}>{child}</div>
  );
  const body = (): ReactNode => {
    if (lang && asSource) return <TextViewer source={source} lang={lang} maxBytes={maxBytes} className="max-h-[70vh]" />;
    switch (kind) {
      case "image":
        return media(<ImageViewer source={source} />);
      case "video":
        return media(<VideoViewer source={source} />);
      case "audio":
        return <AudioViewer source={source} />;
      case "markdown":
        return <MarkdownViewer source={source} maxBytes={maxBytes} fill={fill} />;
      case "html":
        return <HtmlViewer source={source} name={source.name} maxBytes={maxBytes} />;
      case "table":
        return (
          <TableViewer
            source={source}
            format={tableFormat({ path: source.name, mime: source.mime, object_type: source.objectType })}
            maxBytes={maxBytes}
            fill={fill}
          />
        );
      case "json":
        return <JsonViewer source={source} maxBytes={maxBytes} />;
      case "figure":
        return media(<FigureViewer source={source} className="h-full rounded bg-bg" />);
      case "pointcloud":
      case "mesh":
      case "boxes3d":
        return media(<Scene3DViewer source={source} kind={kind} />);
      case "arrays":
        return <NpzViewer source={source} />;
      case "tensor":
        return media(<TensorViewer source={source} />);
      case "text":
        return <TextViewer source={source} lang={langFromPath(source.name)} maxBytes={maxBytes} className="max-h-[70vh]" />;
      case "pickle":
        return <PickleInfo meta={source.meta} loadSnippet={loadSnippet} />;
      default:
        return (
          <div className="h-48">
            <UnsupportedArtifact
              label="No preview for this file type"
              detail={loadSnippet ? `Python: ${loadSnippet}` : undefined}
              downloadUrl={source.url}
              filename={source.name}
            />
          </div>
        );
    }
  };
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${fill ? "h-full min-h-0" : ""}`} data-content-viewer={kind}>
      {lang && (
        <ViewModeSwitch
          modes={["rendered", "source"] as const}
          value={asSource ? "source" : "rendered"}
          onChange={(m) => setAsSource(m === "source")}
          labels={{ rendered: "Rendered", source: "Source" }}
        />
      )}
      <Suspense fallback={<ViewerLoading className={fill ? "h-full" : "h-48"} />}>{body()}</Suspense>
    </div>
  );
}
