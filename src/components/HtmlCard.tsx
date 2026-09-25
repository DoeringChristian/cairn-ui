/**
 * HTML card — renders `cairn.Html` blobs inside a sandboxed iframe.
 *
 * Security contract (do not weaken): logged HTML is NEVER rendered inline in
 * the host document. It only ever runs inside an `<iframe sandbox="allow-scripts"
 * srcdoc=...>` — no `allow-same-origin`, no `allow-top-navigation`, no
 * `allow-popups`, no `allow-forms`. This gives the iframe an opaque origin
 * (no access to cairn's cookies/localStorage/DOM) while still letting the
 * user's inline `<script>` run for interactive reports.
 *
 * Auto-height: a tiny shim is injected into the srcdoc; it watches the
 * document body with a ResizeObserver and posts `cairn:resize` to the host
 * (received by card-kit's useIframeAutoHeight). If no resize message ever arrives, the card falls back to a
 * fixed height from settings.
 */

import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useIframeAutoHeight } from "./card-kit";
import SteppedMediaCard, { type SteppedMediaCardProps } from "./media/SteppedMediaCard";
import type { HtmlSettings } from "./cards-settings/html";
import Toggle from "./settings/Toggle";
import Slider from "./settings/Slider";

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 2000;

/**
 * Resize shim injected into the srcdoc.
 *
 * A sandboxed `srcdoc` iframe's layout is not guaranteed to have settled by
 * the time `load` fires or `ResizeObserver.observe()` delivers its initial
 * callback — both can (and do) report `scrollHeight === 0` a moment before
 * the real content lays out, with no further ResizeObserver callback ever
 * firing afterward for static content. So on top of the (always-on, event
 * driven) ResizeObserver/MutationObserver, re-post on a short bounded
 * schedule of timeouts anchored to `load` to catch that late settle. The
 * schedule is fixed-length (never an unbounded interval/poll), so content
 * that legitimately never grows past height 0 just stops posting after the
 * last scheduled retry instead of spinning forever.
 *
 * Measurement: the height is taken from `document.body`, NOT from
 * `document.documentElement.scrollHeight` — the latter is clamped by the
 * browser to be at least the iframe's current viewport height, so once the
 * host makes the iframe tall the reported height can never go back down
 * (it ratchets: whatever height the host applies becomes the floor the
 * shim reports back, and the card can grow but never shrink).
 * `body.scrollHeight` has no such clamp; we take
 * max(body.scrollHeight, body.offsetHeight) — scrollHeight wins when
 * content overflows the body's box, offsetHeight when the body has
 * explicit height/borders — and add the body's top/bottom margins (8px
 * each by default) so content isn't clipped by them. Fallback for a
 * document with no body: the html element's own border-box rect height
 * (its box tracks content when `height` is auto, and is not viewport
 * clamped, unlike its scrollHeight). Known limitation: absolutely
 * positioned content that escapes the body's scrollable overflow
 * (positioned against the initial containing block) isn't counted — the
 * only measure that would catch it is the clamped
 * documentElement.scrollHeight, which would reintroduce the ratchet.
 */
const RESIZE_SHIM = `<script>(function(){function height(){var b=document.body;if(!b)return Math.ceil(document.documentElement.getBoundingClientRect().height);var m=0;try{var s=getComputedStyle(b);m=(parseFloat(s.marginTop)||0)+(parseFloat(s.marginBottom)||0)}catch(e){}return Math.ceil(Math.max(b.scrollHeight,b.offsetHeight)+m)}function post(){try{parent.postMessage({type:"cairn:resize",height:height(),protocolVersion:1},"*")}catch(e){}}try{new ResizeObserver(post).observe(document.body||document.documentElement)}catch(e){}try{new MutationObserver(post).observe(document.body||document.documentElement,{childList:true,subtree:true})}catch(e){}window.addEventListener("load",function(){post();[0,100,300,1000].forEach(function(d){setTimeout(post,d)})});post();})();</script>`;

function injectResizeShim(html: string): string {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${RESIZE_SHIM}</body>`);
  if (/<\/html>/i.test(html)) return html.replace(/<\/html>/i, `${RESIZE_SHIM}</html>`);
  return html + RESIZE_SHIM;
}

/** One HTML artifact in a sandboxed iframe, sized by the resize shim or `fixedHeight`. */
function HtmlFrame({
  hash,
  name,
  autoHeight,
  fixedHeight,
}: {
  hash: string;
  name: string;
  autoHeight: boolean;
  fixedHeight: number;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let cancelled = false;
    setError(null);
    fetch(api.artifactUrl(hash))
      .then((r) => r.text())
      .then((html) => { if (!cancelled) iframe.srcdoc = injectResizeShim(html); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [hash]);

  // Until the first resize message arrives this is undefined and the frame
  // keeps `fixedHeight`.
  const measuredHeight = useIframeAutoHeight(iframeRef, {
    min: MIN_HEIGHT,
    max: MAX_HEIGHT,
    enabled: autoHeight,
  });

  if (error) {
    return <div className="rounded bg-bg p-2 text-xs text-status-failed overflow-auto"><pre>{error}</pre></div>;
  }
  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-scripts"
      className="w-full rounded border-0 bg-bg"
      style={{ height: autoHeight ? (measuredHeight ?? fixedHeight) : fixedHeight }}
      title={`HTML: ${name}`}
    />
  );
}

export default function HtmlCard(props: SteppedMediaCardProps) {
  return (
    <SteppedMediaCard<HtmlSettings>
      {...props}
      kind="html"
      noun="HTML"
      defaultMime="text/html"
      defaultHeight={360}
      nearest
      settingsPanel={(ctl) => (
        <>
          <Toggle
            label="Auto-height"
            checked={ctl.value.autoHeight}
            onChange={(v) => ctl.set({ autoHeight: v })}
            description={'Resize to the document’s content height via the "cairn:resize" postMessage shim. Falls back to a fixed height if the document never posts a size.'}
          />
          <Slider
            label="Fixed height"
            value={ctl.value.fixedHeight}
            onChange={(v) => ctl.set({ fixedHeight: v })}
            min={MIN_HEIGHT}
            max={MAX_HEIGHT}
            step={20}
            format={(v) => `${v}px`}
          />
        </>
      )}
      renderArtifact={({ hash, name, settings, single }) => {
        const frame = <HtmlFrame hash={hash} name={name} autoHeight={settings.autoHeight} fixedHeight={settings.fixedHeight} />;
        return single ? <div className="flex-1 min-h-0 overflow-auto">{frame}</div> : frame;
      }}
    />
  );
}
