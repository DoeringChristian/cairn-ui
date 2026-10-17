import { useEffect, useRef, useState } from "react";
import { ReportTable, type CapturedSeries } from "./ReportTable";
import { ReportPlot, type ReportFigure } from "./ReportPlot";
import CardShell from "../../CardShell";
import type { BaseCardSettings } from "../../card-kit";
import { CardMutationContext } from "../../../lib/card-settings";
import type { ViewerSetting } from "../../../lib/custom/manifest";
import { useSessionSettings } from "./ReportSettings";
import { ViewerSettingsPanel } from "../../settings-panels/CustomSettingsPanel";

export type CapturedCardSpec = {type: string; title?: string; caption?: string; html: string; data?: CapturedSeries[]; height?: number; figure?: ReportFigure; legend?: boolean; custom?: {manifest: {settings: ViewerSetting[]}; settings: Record<string, string | number | boolean>}};
export function CapturedCard({spec, onCopySource, onComment, onEditSource}: {spec: CapturedCardSpec; onCopySource: () => void; onComment?: () => void; onEditSource?: () => void}) {
  if ((spec.type === "table" || spec.type === "scalar") && spec.data) return <ReportTable series={spec.data} scalar={spec.type === "scalar"} title={spec.title} caption={spec.caption} onCopySource={onCopySource} onComment={onComment} onEditSource={onEditSource} />;
  if (spec.figure) return <ReportPlot figure={spec.figure} title={spec.title} caption={spec.caption} height={spec.height} onCopySource={onCopySource} onComment={onComment} onEditSource={onEditSource} />;
  if (spec.data && ["line", "bar", "scatter", "histogram"].includes(spec.type)) {
    const figure: ReportFigure = {data: spec.data.map(series => spec.type === "histogram"
      ? {type: "histogram", x: series.points.map(point => point.y), name: series.name}
      : {type: spec.type === "bar" ? "bar" : "scatter", mode: spec.type === "scatter" ? "markers" : "lines", x: series.points.map(point => point.x), y: series.points.map(point => point.y), name: series.name}), layout: {showlegend: spec.legend ?? true, margin: {l: 50, r: 20, t: 25, b: 45}}};
    return <ReportPlot figure={figure} title={spec.title} caption={spec.caption} height={spec.height} onCopySource={onCopySource} onComment={onComment} onEditSource={onEditSource}/>;
  }
  return <CapturedFrame spec={spec} onCopySource={onCopySource} onComment={onComment} onEditSource={onEditSource} />;
}
function CapturedFrame({spec, onCopySource, onComment, onEditSource}: {spec: CapturedCardSpec; onCopySource: () => void; onComment?: () => void; onEditSource?: () => void}) {
  const card = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [settings, setSettings] = useState(false);
  const height = Math.max(200, Math.min(spec.height || 360, 1200));
  const ctl = useSessionSettings<BaseCardSettings>({version: 1});
  const [viewerSettings, setViewerSettings] = useState(spec.custom?.settings || {});
  const postSettings = () => {if (spec.custom) frame.current?.contentWindow?.postMessage({type: "cairn:card-settings", patch: viewerSettings}, "*");};
  useEffect(postSettings, [viewerSettings]);
  const [notice, setNotice] = useState("");
  const pending = useRef<{id: string; timer: ReturnType<typeof setTimeout>} | null>(null);
  const download = (href: string, name: string) => {const link = document.createElement("a"); link.href = href; link.download = name; link.click();};
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== "cairn:card-screenshot" || event.data.requestId !== pending.current?.id) return;
      if (pending.current) clearTimeout(pending.current.timer); pending.current = null;
      if (typeof event.data.dataUrl === "string" && event.data.dataUrl.startsWith("data:image/")) {download(event.data.dataUrl, `${spec.title || "card"}.png`); setNotice("");}
      else setNotice(event.data.error || "Screenshot unavailable for this card.");
    };
    window.addEventListener("message", receive);
    return () => {window.removeEventListener("message", receive); if (pending.current) clearTimeout(pending.current.timer);};
  }, [spec.title]);
  const screenshot = () => {
    if (pending.current) clearTimeout(pending.current.timer);
    const id = crypto.randomUUID();
    setNotice("Capturing screenshot…");
    pending.current = {id, timer: setTimeout(() => {pending.current = null; setNotice("This card did not return a screenshot. Try Download data in the menu.");}, 15000)};
    frame.current?.contentWindow?.postMessage({type: "cairn:card-screenshot", requestId: id}, "*");
  };
  const hasSettings = !!spec.custom?.manifest.settings.length;
  return <figure className="document-embedded-card">
    <CardMutationContext.Provider value={false}>
      <CardShell
        cardRef={card}
        settings={ctl.value}
        updateSettings={ctl.set}
        title={spec.title || "Report card"}
        cardKind="custom"
        onScreenshot={screenshot}
        onSettings={hasSettings ? () => setSettings(true) : undefined}
        onDownload={() => {const url = URL.createObjectURL(new Blob([spec.html], {type: "text/html"})); download(url, `${spec.title || "card"}.html`); setTimeout(() => URL.revokeObjectURL(url), 1000);}}
        onResetView={() => {ctl.resetAll(); setViewerSettings(spec.custom?.settings || {}); frame.current?.contentWindow?.postMessage({type: "cairn:card-reset"}, "*");}}
        headerMenu={[{icon: "fa-link", label: "Copy source reference", onClick: onCopySource}, ...(onComment ? [{icon: "fa-comment", label: "Comments", onClick: onComment}] : []), ...(onEditSource ? [{icon: "fa-pen", label: "Edit source", onClick: onEditSource}] : [])]}
        settingsPanel={spec.custom && hasSettings ? <ViewerSettingsPanel settings={spec.custom.manifest.settings} value={viewerSettings} defaults={spec.custom.settings} onChange={patch => setViewerSettings(previous => ({...previous, ...patch}))} /> : undefined}
        modalOpen={settings}
        onModalClose={() => setSettings(false)}
        modalContent={hasSettings ? <iframe ref={settings ? frame : undefined} title={spec.title || "Report card"} sandbox="allow-scripts" srcDoc={spec.html} onLoad={postSettings} style={{height: "100%", minHeight: 420, width: "100%", border: 0}} /> : undefined}
      >
        {!settings && <iframe ref={frame} title={spec.title || "Report card"} sandbox="allow-scripts" srcDoc={spec.html} onLoad={postSettings} style={{height, width: "100%", border: 0}} loading="lazy" />}
        {notice && <p role="status" className="text-xs text-fg-muted">{notice}</p>}
      </CardShell>
    </CardMutationContext.Provider>
    {spec.caption && <figcaption>{spec.caption}</figcaption>}
  </figure>;
}
