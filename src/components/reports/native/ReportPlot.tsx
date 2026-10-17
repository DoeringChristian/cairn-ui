import { useRef, useState } from "react";
import { InteractiveFigure } from "../../viewers/FigureViewer";
import { downloadCardPng } from "../../../lib/download";
import CardShell from "../../CardShell";
import { CardMutationContext } from "../../../lib/card-settings";
import { builtin, type FigureSettings } from "../../cards-settings/figure";
import { FigureAppearanceSettings } from "../../settings-panels/FigureSettingsPanel";
import { useSessionSettings } from "./ReportSettings";

export type ReportFigure = {data: Record<string, unknown>[]; layout?: Record<string, unknown>};
// Reports use the same lifecycle as every other figure surface. In particular,
// interaction must not recreate Plotly on parent renders or reset zoom ranges.
function PlotCanvas({figure, settings, height, revision}: {figure: ReportFigure; settings: FigureSettings; height: number | string; revision: number}) {
  return <InteractiveFigure figure={figure} settings={settings} revision={revision} className="min-w-0" style={{height, minHeight: 300, width: "100%"}} />;
}
export function ReportPlot({figure, title = "Figure", caption, height = 360, onCopySource, onEditSource}: {figure: ReportFigure; title?: string; caption?: string; height?: number; onCopySource?: () => void; onEditSource?: () => void}) {
  const card = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const stateCtl = useSessionSettings<FigureSettings>({...builtin, displayModeBar: true, showLegend: figure.layout?.showlegend !== false});
  const ctl = {...stateCtl, resetAll: () => {stateCtl.resetAll(); setRevision(value => value + 1);}};
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(figure, null, 2)], {type: "application/json"}));
    const link = document.createElement("a"); link.href = url; link.download = `${title}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <figure className="document-embedded-card">
    <CardMutationContext.Provider value={false}>
      <CardShell
        cardRef={card}
        settings={ctl.value}
        updateSettings={ctl.set}
        title={title}
        cardKind="figure"
        onScreenshot={() => {if (card.current) void downloadCardPng(card.current, title).catch(error => setError(String(error)));}}
        onSettings={() => setOpen(true)}
        onDownload={download}
        onResetView={ctl.resetAll}
        headerMenu={[...(onCopySource ? [{icon: "fa-link", label: "Copy source reference", onClick: onCopySource}] : []), ...(onEditSource ? [{icon: "fa-pen", label: "Edit source", onClick: onEditSource}] : [])]}
        settingsPanel={<FigureAppearanceSettings ctl={ctl} />}
        modalOpen={open}
        onModalClose={() => setOpen(false)}
        modalContent={<PlotCanvas figure={figure} settings={ctl.value} revision={revision} height="100%" />}
      >
        {error && <p role="alert">{error}</p>}
        <PlotCanvas figure={figure} settings={ctl.value} revision={revision} height={height} />
      </CardShell>
    </CardMutationContext.Provider>
    {caption && <figcaption>{caption}</figcaption>}
  </figure>;
}
