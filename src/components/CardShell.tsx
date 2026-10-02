import { useContext, useEffect, type CSSProperties, type ReactNode, type RefObject } from "react";
import { CardMutationContext, resolveCardHeight, type SetOptions } from "../lib/card-settings";
import { InteractContext, useInteractState } from "../lib/use-interact";
import { cardMinSize } from "./card-kit/card-min-sizes";
import type { BaseCardSettings } from "./card-kit";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import CardDetailModal from "./CardDetailModal";
import CardErrorBoundary from "./card-kit/CardErrorBoundary";
import { useCardNavEntry } from "../lib/card-nav";
import { useReportExporting } from "../lib/reports/export-context";
import { PanelTitleContext } from "../lib/workspace/panel-actions";

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
  /** Reset the card's interactive view to default. Renders a home button left of download, only when `viewModified`. */
  onResetView?: () => void;
  viewModified?: boolean;
  onDownload?: () => void;
  onScreenshot?: () => void;
  /** AddToReportButton. */
  addToReportSlot?: ReactNode;
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
  viewModified,
  onDownload,
  onScreenshot,
  addToReportSlot,
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
  // ←/→ in the detail modal: close this card's modal, open the neighbour's.
  const nav = useCardNavEntry(onSettings, modalContent !== undefined && !collapsed, !!modalOpen);
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
          onSettings={onSettings}
          onResetView={onResetView}
          viewModified={viewModified}
          onRemove={onRemove}
          onDownload={onDownload}
          onScreenshot={onScreenshot}
          addToReportSlot={addToReportSlot}
          cardActions={headerActions}
          interact={interact.available && !collapsed
            ? { on: interact.on, onToggle: interact.toggle }
            : undefined}
        />
        {!collapsed && (
          <>
            <CardErrorBoundary label={shownTitle}>{children}</CardErrorBoundary>
            {modalContent !== undefined && (
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
            )}
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
