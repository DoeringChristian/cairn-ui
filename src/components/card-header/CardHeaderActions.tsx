/** Three primary controls: Screenshot, Settings, and an overflow list. */

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useClickOutside } from "../../lib/use-click-outside";
import { CardActionButton } from "./CardActionButton";

export interface CardActionHandlers {
  onScreenshot: () => void;
  onDownload: () => void;
  /** The "add to report" button (AddToReportButton); editable cards only. */
  addToReport?: ReactNode;
  onResetView: () => void;
  onSettings?: () => void;
  /** Editable cards only. */
  onDuplicate?: () => void;
  /** Editable cards only. */
  onRemove?: () => void;
}

/** The actions, in their one order: `addToReport` is its own button (a popover). */
export const CARD_ACTIONS = [
  { key: "onScreenshot", icon: "fa-camera", label: "Screenshot" },
  { key: "onDownload", icon: "fa-download", label: "Download data" },
  { key: "addToReport", icon: "fa-file-circle-plus", label: "Add to report" },
  { key: "onResetView", icon: "fa-rotate-left", label: "Reset view" },
  { key: "onSettings", icon: "fa-gear", label: "Settings" },
  { key: "onDuplicate", icon: "fa-clone", label: "Duplicate card" },
  { key: "onRemove", icon: "fa-xmark", label: "Remove card" },
] as const;

export interface MenuItem {
  icon: string;
  label: string;
  onClick: () => void;
}

export default function CardHeaderActions({
  actions,
  compact: _compact,
  extraMenu = [],
  extraContent,
}: {
  actions: CardActionHandlers;
  /** Below `md`: the actions fold into "⋯". */
  compact: boolean;
  /** More "⋯" entries while compact (move up / down on touch screens), before remove. */
  extraMenu?: MenuItem[];
  extraContent?: ReactNode;
}) {
  const buttons: ReactNode[] = [];
  const menu: MenuItem[] = [];
  for (const a of CARD_ACTIONS) {
    if (a.key === "addToReport") {

      continue;
    }
    const run = actions[a.key];
    if (!run && a.key !== "onSettings") continue;
    if (a.key !== "onScreenshot" && a.key !== "onSettings") {
      if (a.key === "onRemove") menu.push(...extraMenu);
      menu.push({ icon: a.icon, label: a.label, onClick: run! });
    } else {
      buttons.push(
        <CardActionButton key={a.key} action={a.key === "onScreenshot" ? "screenshot" : "settings"} onClick={run} disabled={!run} aria-label={a.label} title={a.label} data-card-action={a.key} />,
      );
    }
  }
  if (!actions.onRemove) menu.push(...extraMenu);
  return (
    <div className="cairn-card-actions" data-card-actions>
      {buttons}
      <OverflowMenu items={menu}>{actions.addToReport}{extraContent}</OverflowMenu>
    </div>
  );
}

/**
 * "⋯" button with a small action list, right-aligned under it so it opens
 * towards the card's interior (the button sits at the card's right edge).
 */
export function OverflowMenu({ items, children }: { items: MenuItem[]; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(wrapRef, close, open);

  return (
    <div ref={wrapRef} className="relative" onKeyDown={event => {if (event.key === "Escape") {setOpen(false); event.stopPropagation();}}}>
      <CardActionButton
        action="menu"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        title="More actions"
      />
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-[11rem] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-bg py-1 text-sm text-fg shadow-lg"
        >
          {children && <div className="border-b border-border-subtle px-3 py-2 flex flex-wrap gap-2">{children}</div>}
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 touch:py-3 text-left hover:bg-bg-hover"
            >
              <i className={`fa-solid ${item.icon} w-4 text-center text-fg-muted`} aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
