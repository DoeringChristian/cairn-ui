/**
 * Logged HTML (`cairn.Html`, an `.html` file) in a sandboxed iframe: the
 * HTML card's pane, and every HTML file.
 *
 * Security contract (do not weaken): logged HTML is NEVER rendered inline in
 * the host document. It is its own document, served by the server
 * (`GET /api/artifacts/{hash}/html`, cairn/server/routes/artifacts.py) with
 * `Content-Security-Policy: sandbox allow-scripts allow-popups
 * allow-popups-to-escape-sandbox`, and framed with the same `sandbox`
 * attribute — never `allow-same-origin` (the document would be cairn's
 * origin: its cookies, storage and API) and never `allow-top-navigation`.
 * Like wandb.Html it may load anything else: CDN scripts, images, external
 * iframes (it does not inherit the app shell's `frame-src`, as a srcdoc
 * frame would). Its own navigation is still checked against the app shell's
 * `frame-src 'self' blob:`.
 *
 * Custom viewers (custom/ViewerFrame.tsx) are a different contract: their
 * code gets no network at all.
 *
 * Auto-height: the server injects a shim that posts `cairn:resize` to the
 * host (received by card-kit's useIframeAutoHeight). If no resize message
 * ever arrives, the frame keeps `fixedHeight`.
 */

import { useRef } from "react";
import { api } from "../../api/client";
import type { ViewerSource } from "../../lib/viewers/source";
import { useIframeAutoHeight } from "../card-kit/use-iframe-auto-height";
import { HTML_MAX_HEIGHT as MAX_HEIGHT, HTML_MIN_HEIGHT as MIN_HEIGHT, builtin as HTML_DEFAULTS } from "../cards-settings/html";
import { TruncatedNote } from "./use-viewer-text";

/** The iframe's sandbox: the same flags as the document's CSP sandbox (HTML_DOC_SANDBOX on the server). */
export const HTML_FRAME_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox";

/** Where the frame loads `source` from (its head only when it is bigger than `maxBytes`). */
export function htmlDocumentUrl(source: Pick<ViewerSource, "hash" | "size">, maxBytes?: number): { url: string; cut: boolean } {
  const cut = maxBytes != null && source.size != null && source.size > maxBytes;
  return { url: api.artifactHtmlUrl(source.hash, cut ? maxBytes : undefined), cut };
}

/**
 * One HTML artifact in a sandboxed iframe, sized by the resize shim or
 * `fixedHeight`. A step change navigates the same frame: the browser holds
 * the old paint until the next document renders, so it never flashes empty.
 */
export default function HtmlViewer({
  source,
  name,
  autoHeight = HTML_DEFAULTS.autoHeight,
  fixedHeight = HTML_DEFAULTS.fixedHeight,
  maxBytes,
}: {
  source: Pick<ViewerSource, "hash" | "size">;
  /** The frame's accessible title: "HTML: {name}". */
  name: string;
  autoHeight?: boolean;
  fixedHeight?: number;
  /** Show at most this many bytes (the head of a big file). */
  maxBytes?: number;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const { url, cut } = htmlDocumentUrl(source, maxBytes);

  // Until the first resize message arrives this is undefined and the frame
  // keeps `fixedHeight`.
  const measuredHeight = useIframeAutoHeight(iframeRef, {
    min: MIN_HEIGHT,
    max: MAX_HEIGHT,
    enabled: autoHeight,
  });

  // One tree shape whether or not the text is cut: the frame never remounts.
  return (
    <div className="flex flex-col gap-1">
      {cut && maxBytes != null && <TruncatedNote shown={maxBytes} total={source.size} />}
      <iframe
        ref={iframeRef}
        sandbox={HTML_FRAME_SANDBOX}
        src={url}
        className="w-full rounded border-0 bg-bg"
        style={{ height: autoHeight ? (measuredHeight ?? fixedHeight) : fixedHeight }}
        title={`HTML: ${name}`}
        data-viewer="html"
      />
    </div>
  );
}
