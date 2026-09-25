/**
 * The run page's custom panels (built by the toolbar's quick panel builder):
 * line plots of several metrics, kept in the project workspace so every run
 * of the project shows them. Settings are per panel, shared across runs.
 */

import CardRenderer from "./CardRenderer";
import ReorderableCardGrid from "./ReorderableCardGrid";
import SectionBlock from "./SectionBlock";
import type { CardSettingsKey } from "../lib/card-settings";
import type { CustomPanel } from "../lib/workspace/doc";

export const CUSTOM_SECTION = "Custom panels";

/** Where a custom panel's settings live: per project and panel, not per run. */
export function customPanelSettingsKey(projectId: string, panelId: string): CardSettingsKey {
  return { runId: `custom:${projectId}`, metricName: panelId };
}

interface Props {
  projectId: string;
  runId: string;
  panels: CustomPanel[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onRemove?: (panelId: string) => void;
}

export default function CustomPanelCards({ projectId, runId, panels, collapsed, onToggleCollapse, onRemove }: Props) {
  if (panels.length === 0) return null;
  return (
    <SectionBlock
      sectionName={CUSTOM_SECTION}
      itemCount={panels.length}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      cardTypes={["scalar"]}
    >
      <ReorderableCardGrid
        cards={panels.map((panel) => ({
          key: `custom:${panel.id}`,
          content: (
            <CardRenderer
              runId={runId}
              metric={{ name: panel.metrics[0] ?? panel.title, object_type: "scalar", min_step: 0, max_step: 0, count: 0 }}
              extraSeries={panel.metrics.slice(1).map((name) => ({ runId, name }))}
              controlledSeries
              settingsKeyOverride={customPanelSettingsKey(projectId, panel.id)}
              onRemove={onRemove ? () => onRemove(panel.id) : undefined}
            />
          ),
        }))}
      />
    </SectionBlock>
  );
}
