import { createContext, useContext, useId, useLayoutEffect, useState, type ReactNode } from "react";
import { SETTINGS_TABS, activeTab, showTabBar, visibleTabs, type SettingsTabId } from "./logic";

interface Props {
  /** Each tab's content; a missing / null / false tab is hidden. */
  tabs: Partial<Record<SettingsTabId, ReactNode>>;
  /** Controlled active tab (else kept internally, starting at the first visible). */
  active?: SettingsTabId;
  onActiveChange?: (tab: SettingsTabId) => void;
}

/**
 * A surrounding editor that draws the one tab row itself (the workspace's
 * card editor): the panel reports its visible tabs and shows only the
 * content of the editor's active tab (`null`: none of its own).
 */
export const SettingsTabsHostContext = createContext<{
  active: SettingsTabId | null;
  report: (tabs: SettingsTabId[]) => void;
} | null>(null);

function hasContent(node: ReactNode): boolean {
  return node != null && node !== false;
}

/** The tab row of a settings panel (also the card editor's). */
export function SettingsTabBar<K extends string>({
  items,
  current,
  onSelect,
  panelId,
}: {
  items: ReadonlyArray<{ id: K; label: string; disabled?: boolean }>;
  current: K;
  onSelect: (id: K) => void;
  /** The id of the tab panel the tabs control. */
  panelId?: string;
}) {
  return (
    <div role="tablist" className="flex min-w-0 gap-1 overflow-x-auto">
      {items.map((t) => {
        const on = t.id === current;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={panelId}
            disabled={t.disabled}
            onClick={() => onSelect(t.id)}
            data-tab={t.id}
            className={[
              "-mb-px shrink-0 border-b-2 px-2 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 touch:min-h-10 touch:px-3",
              on ? "border-accent font-medium text-fg" : "border-transparent text-fg-muted hover:text-fg",
            ].join(" ")}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The fixed Values · Grouping · Display · Expressions tabs of a settings panel.
 * Tabs without content are hidden; with a single tab left there is no bar.
 */
export default function SettingsTabs({ tabs, active, onActiveChange }: Props) {
  const id = useId();
  const host = useContext(SettingsTabsHostContext);
  const [own, setOwn] = useState<SettingsTabId | null>(null);
  const visible = visibleTabs({
    values: hasContent(tabs.values),
    grouping: hasContent(tabs.grouping),
    display: hasContent(tabs.display),
    expressions: hasContent(tabs.expressions),
  });
  const shown = visible.join(" ");
  useLayoutEffect(() => {
    host?.report(shown ? (shown.split(" ") as SettingsTabId[]) : []);
  }, [host, shown]);
  if (host) return host.active && visible.includes(host.active) ? <div>{tabs[host.active]}</div> : null;
  const current = activeTab(active ?? own, visible);
  if (current == null) return null;
  if (!showTabBar(visible)) return <div>{tabs[current]}</div>;

  const select = (tab: SettingsTabId) => {
    setOwn(tab);
    onActiveChange?.(tab);
  };
  return (
    <div>
      <div className="-mx-1 mb-2 border-b border-border px-1">
        <SettingsTabBar items={SETTINGS_TABS.filter((t) => visible.includes(t.id))} current={current} onSelect={select} panelId={`${id}-panel`} />
      </div>
      <div role="tabpanel" id={`${id}-panel`}>
        {tabs[current]}
      </div>
    </div>
  );
}
