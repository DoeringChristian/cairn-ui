import { useContext, useEffect, type CSSProperties, type ReactNode, type RefObject } from "react";
import { CardMutationContext, resolveCardHeight, type SetOptions } from "../lib/card-settings";
import { InteractContext, useInteractState } from "../lib/use-interact";
import { cardMinSize } from "./card-kit/card-min-sizes";
import type { BaseCardSettings } from "./card-kit";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import CardDetailModal from "./CardDetailModal";
import CardErrorBoundary from "./card-kit/CardErrorBoundary";
import { useCardNavEntry, useOpenOnMount } from "../lib/card-nav";
import { useReportExporting } from "../lib/reports/export-context";
import { PanelActionsContext, PanelTitleContext } from "../lib/workspace/panel-actions";
import { CardEditorSlots, useCardEditorHost } from "./workspace/card-editor-host";
import AddToReportButton from "./AddToReportButton";
import { CardReportContext } from "../lib/card-report-context";
import { downloadCardArtifacts, downloadCardPng, resetPlotlyViews } from "../lib/download";

interface Props {
  cardRef: RefObject<HTMLDivElement>;
  settings: BaseCardSettings;
  updateSettings: (patch: Record<string, unknown>, opts?: SetOptions) => void;
  title: string;
  subtitle?: ReactNode;
  /**
   * Show the subtitle only while the card is collapsed: a step readout that
   * the card's own step slider shows anyway while it is open.
   */
  subtitleCollapsedOnly?: boolean;
  defaultHeight?: number;
  /** Card type key for per-type minimum sizes (see card-kit/card-min-sizes). */
  cardKind?: string;
  onRemove?: () => void;
  onSettings?: () => void;
  /** Reset the card's own view state (zoom, camera, slider…); Plotly figures are reset too. */
  onResetView?: () => void;
  /** The card's data (a CSV, a patch); default: the artifacts it shows at its step (one file, or a zip). */
  onDownload?: () => void;
  /** Card-specific controls, left of the header's bar. */
  headerActions?: ReactNode;
  dropHighlight?: boolean;
  dropProps?: Record<string, unknown>;
  /** Settings form rendered in the detail modal's side panel. */
  settingsPanel?: ReactNode;
  /** Main content of the detail modal (the card at full size). */
  modalContent?: ReactNode;
  /** Whether the detail modal is open. */
  modalOpen?: boolean;
  /** Close handler for the detail modal. */
  onModalClose?: () => void;
  /** When true on mount, scroll the card into view once (e.g. just-added card). */
  scrollIntoViewOnMount?: boolean;
  children: ReactNode;
}

export default function CardShell({
  cardRef,
  settings,
  updateSettings,
  title,
  subtitle,
  subtitleCollapsedOnly,
  defaultHeight,
  cardKind,
  onRemove,
  onSettings,
  onResetView,
  onDownload,
  headerActions,
  dropHighlight,
  dropProps,
  settingsPanel,
  modalContent,
  modalOpen,
  onModalClose,
  scrollIntoViewOnMount,
  children,
}: Props) {
  // Scroll a just-added card into view once, on mount. Deliberately runs
  // only on the initial mount (not when the flag later flips false) so a
  // parent can clear its transient "just added" state without re-triggering.
  useEffect(() => {
    if (scrollIntoViewOnMount) {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A workspace panel over several metrics is titled by the panel, not its first metric.
  const panelTitle = useContext(PanelTitleContext);
  const shownTitle = settings.title ?? panelTitle ?? title;
  const minSize = cardMinSize(cardKind);
  // Own-min read-time clamp lives inside resolveCardHeight (single source);
  // pass the same minHeight anywhere inner content re-reads this height so
  // the outer box and inner content never disagree.
  const clampedHeight = resolveCardHeight(settings, defaultHeight, minSize.minHeight);
  // A report export shows every card, collapsed or not (nothing is saved).
  const exporting = useReportExporting();
  const collapsed = !!settings.collapsed && !exporting;

  // Tap-to-interact (touch devices): content that captures gestures registers
  // through `useInteract`; the detail modal is always interactive.
  const interact = useInteractState(!!modalOpen);
  // Read-only cards (report viewers, embeds) keep their size.
  const mutable = useContext(CardMutationContext);
  // A workspace card opens in the workspace's card editor (data, type, title, then its settings).
  const panelActions = useContext(PanelActionsContext);
  const reportCopy = useContext(CardReportContext);
  const hosted = useCardEditorHost();
  const panelId = mutable && hosted ? panelActions?.panelId : undefined;
  // ←/→ in the detail modal: close this card's modal, open the neighbour's.
  const nav = useCardNavEntry(onSettings, modalContent !== undefined && !collapsed, !!modalOpen);
  // Mounted by ←/→ from a neighbour's modal (workspace/LazyPanel): open ours.
  useOpenOnMount(modalContent !== undefined && !collapsed ? onSettings : undefined);
  const step = (go?: () => void) =>
    go &&
    (() => {
      onModalClose?.();
      go();
    });

  return (
    <div
      ref={cardRef}
      data-cairn-card
      data-cairn-min-h={minSize.minHeight}
      data-cairn-min-span={minSize.minSpan}
      // Phones re-clamp a fixed height against the viewport (index.css).
      data-cairn-fixed-h={clampedHeight != null ? "" : undefined}
      className={`card p-4 flex min-w-0 flex-col${dropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
      style={{
        height: clampedHeight,
        "--cairn-card-h": clampedHeight != null ? `${clampedHeight}px` : undefined,
        position: "relative",
        gridColumn: `span ${settings.colSpan ?? 3}`,
      } as CSSProperties}
      {...dropProps}
    >
      <InteractContext.Provider value={interact.value}>
        <CardHeader
          title={shownTitle}
          onTitleChange={(t) => updateSettings({ title: t || undefined })}
          subtitle={subtitleCollapsedOnly && !collapsed ? undefined : subtitle}
          collapsed={collapsed}
          onToggleCollapse={() => updateSettings({ collapsed: !settings.collapsed })}
          actions={{
            onScreenshot: () => {
              if (cardRef.current) void downloadCardPng(cardRef.current, shownTitle);
            },
            onDownload:
              onDownload ??
              (() => {
                if (cardRef.current) void downloadCardArtifacts(cardRef.current, shownTitle);
              }),
            addToReport: reportCopy && <AddToReportButton {...reportCopy} />,
            onResetView: () => {
              onResetView?.();
              if (cardRef.current) void resetPlotlyViews(cardRef.current);
            },
            onSettings,
            onDuplicate: panelActions?.onDuplicate,
            onRemove,
          }}
          cardActions={headerActions}
          interact={interact.available && !collapsed
            ? { on: interact.on, onToggle: interact.toggle }
            : undefined}
        />
        {!collapsed && (
          <>
            <CardErrorBoundary label={shownTitle}>{children}</CardErrorBoundary>
            {modalContent !== undefined &&
              (panelId != null ? (
                <CardEditorSlots
                  id={panelId}
                  open={!!modalOpen}
                  onClose={onModalClose ?? (() => {})}
                  title={shownTitle}
                  onPrev={step(nav.prev)}
                  onNext={step(nav.next)}
                  content={<CardErrorBoundary label={shownTitle}>{modalContent}</CardErrorBoundary>}
                  settings={settingsPanel}
                />
              ) : (
                <CardDetailModal
                  open={!!modalOpen}
                  onClose={onModalClose ?? (() => {})}
                  title={shownTitle}
                  settingsContent={settingsPanel}
                  onPrev={step(nav.prev)}
                  onNext={step(nav.next)}
                >
                  <CardErrorBoundary label={shownTitle}>{modalContent}</CardErrorBoundary>
                </CardDetailModal>
              ))}
          </>
        )}
      </InteractContext.Provider>
      {mutable && (
        <CardResizeHandle
          onHeightChange={(h) => updateSettings({ height: h }, { mergeKey: "resize", label: "Resize card" })}
          colSpan={settings.colSpan ?? 3}
          onColSpanChange={(s) => updateSettings({ colSpan: s }, { mergeKey: "resize", label: "Resize card" })}
          minHeight={minSize.minHeight}
        />
      )}
    </div>
  );
}
