import { useId, useState, type ReactNode } from "react";
import { SETTINGS_TABS, activeTab, showTabBar, visibleTabs, type SettingsTabId } from "./logic";

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
export default function SettingsTabs({ tabs, active, onActiveChange }: Props) {
  const id = useId();
  const [own, setOwn] = useState<SettingsTabId | null>(null);
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
