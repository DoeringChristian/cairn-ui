import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { SETTINGS_TABS, activeTab, showTabBar, visibleTabs, type SettingsTabId } from "./logic";

/**
 * Content the surrounding editor puts first in the Data tab (the card's data
 * and type, in the gear's editor). `claim` tells the editor a tabbed panel
 * showed it, so it does not show it a second time above an untabbed one.
 */
export const SettingsDataExtraContext = createContext<{ node: ReactNode; claim: () => void } | null>(null);

/**
 * The tab the next settings panel to mount opens on, once: a card type change
 * in the gear's Data tab remounts the card, and its editor reopens where the
 * user was instead of on the new type's usual first tab.
 */
let pendingTab: SettingsTabId | null = null;
export function openNextSettingsOn(tab: SettingsTabId): void {
  pendingTab = tab;
  // Only the remount right after the change takes it.
  setTimeout(() => {
    if (pendingTab === tab) pendingTab = null;
  }, 2000);
}
export function takePendingSettingsTab(): SettingsTabId | null {
  const t = pendingTab;
  pendingTab = null;
  return t;
}

interface Props {
  /** Each tab's content; a missing / null / false tab is hidden. */
  tabs: Partial<Record<SettingsTabId, ReactNode>>;
  /** Controlled active tab (else kept internally, starting at the first visible). */
  active?: SettingsTabId;
  onActiveChange?: (tab: SettingsTabId) => void;
}

function hasContent(node: ReactNode): boolean {
  return node != null && node !== false;
}

/**
 * The fixed Data · Grouping · Display · Expressions tabs of a settings panel.
 * Tabs without content are hidden; with a single tab left there is no bar.
 */
export default function SettingsTabs({ tabs: given, active, onActiveChange }: Props) {
  const id = useId();
  const extra = useContext(SettingsDataExtraContext);
  useEffect(() => extra?.claim(), [extra]);
  const tabs = extra ? { ...given, data: <>{extra.node}{given.data}</> } : given;
  const [own, setOwn] = useState<SettingsTabId | null>(() => (extra ? takePendingSettingsTab() : null));
  const visible = visibleTabs({
    data: hasContent(tabs.data),
    grouping: hasContent(tabs.grouping),
    display: hasContent(tabs.display),
    expressions: hasContent(tabs.expressions),
  });
  const current = activeTab(active ?? own, visible);
  if (current == null) return null;
  if (!showTabBar(visible)) return <div>{tabs[current]}</div>;

  const select = (tab: SettingsTabId) => {
    setOwn(tab);
    onActiveChange?.(tab);
  };
  return (
    <div>
      <div role="tablist" className="-mx-1 mb-2 flex gap-1 overflow-x-auto border-b border-border px-1">
        {SETTINGS_TABS.filter((t) => visible.includes(t.id)).map((t) => {
          const on = t.id === current;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${id}-${t.id}`}
              aria-selected={on}
              aria-controls={`${id}-panel`}
              onClick={() => select(t.id)}
              className={[
                "-mb-px shrink-0 border-b-2 px-2 py-1.5 text-sm transition-colors touch:min-h-10 touch:px-3",
                on ? "border-accent font-medium text-fg" : "border-transparent text-fg-muted hover:text-fg",
              ].join(" ")}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${current}`}>
        {tabs[current]}
      </div>
    </div>
  );
}
