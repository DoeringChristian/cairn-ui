/**
 * Edit the workspace's (or one section's) card defaults: pick a card type,
 * then that type's own settings panel renders in `mode="defaults"` (cascade
 * keys only) over a controller on the chosen level, with ↺ per key.
 */

import { lazy, Suspense, useMemo, useState, type ComponentType, type LazyExoticComponent } from "react";
import { CARD_TYPES, type CardType } from "../lib/cards/card-spec";
import { metaFor } from "../lib/cards/settings-registry";
import { SETTINGS_PANELS } from "../lib/cards/settings-panels";
import { Select, SettingsAction } from "./settings/palette";
import { useWorkspace } from "../lib/workspace/use-workspace";
import { useDefaultsController, type DefaultsLevel } from "../lib/workspace/use-defaults-controller";

/** Card types that take defaults at all (have cascade keys). */
export const DEFAULTABLE_TYPES: CardType[] = CARD_TYPES.filter((t) => metaFor(t).cascadeKeys.length > 0);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lazyPanels = new Map<CardType, LazyExoticComponent<ComponentType<any>>>();
function panelFor(type: CardType) {
  const load = SETTINGS_PANELS[type];
  if (!load) return null;
  let P = lazyPanels.get(type);
  if (!P) lazyPanels.set(type, (P = lazy(load)));
  return P;
}

const TYPE_LABELS: Partial<Record<CardType, string>> = {
  scalar: "Line plot",
  tile: "Scalar tile",
  bar: "Bar chart",
  parallel: "Parallel coordinates",
  pointcloud: "Point cloud",
  boxes3d: "3D boxes",
};
export const cardTypeLabel = (t: CardType) => TYPE_LABELS[t] ?? t[0]!.toUpperCase() + t.slice(1);

interface Props {
  projectId: string;
  where: DefaultsLevel;
  /** Types offered first (e.g. those in the section); the rest follow. */
  types?: readonly CardType[];
  /** The type selected initially; defaults to the first offered. */
  initialType?: CardType;
}

export default function DefaultsEditor({ projectId, where, types, initialType }: Props) {
  const { doc } = useWorkspace(projectId);
  const ordered = useMemo(() => {
    const first = (types ?? []).filter((t) => DEFAULTABLE_TYPES.includes(t));
    return [...first, ...DEFAULTABLE_TYPES.filter((t) => !first.includes(t))];
  }, [types]);
  const [type, setType] = useState<CardType>(initialType ?? ordered[0] ?? "scalar");

  const levelDefaults = where.level === "workspace" ? doc.defaults : (doc.sectionDefaults[where.section] ?? {});
  const options = ordered.map((t) => ({
    value: t,
    label: `${cardTypeLabel(t)}${levelDefaults[t] ? " •" : ""}`,
  }));

  return (
    <div className="flex flex-col gap-2">
      <Select<CardType> label="Card type" value={type} onChange={setType} options={options} />
      {/* Keyed: a new controller (and panel state) per type. */}
      <DefaultsPanel key={`${type}|${where.level === "section" ? where.section : ""}`} projectId={projectId} type={type} where={where} />
    </div>
  );
}

function DefaultsPanel({ projectId, type, where }: { projectId: string; type: CardType; where: DefaultsLevel }) {
  const ctl = useDefaultsController(projectId, type, where);
  const Panel = panelFor(type);
  const anySet = metaFor(type).cascadeKeys.some((k) => ctl.isOverridden(k));
  if (!Panel) {
    return <p className="py-2 text-sm text-fg-muted">No defaults for this card type yet.</p>;
  }
  return (
    <>
      <Suspense fallback={<p className="py-2 text-sm text-fg-muted">Loading…</p>}>
        <Panel ctl={ctl} mode="defaults" />
      </Suspense>
      {anySet && !ctl.readOnly && (
        <SettingsAction
          label={where.level === "workspace" ? "Reset workspace defaults" : "Reset section defaults"}
          icon="fa-rotate-left"
          tone="danger"
          onClick={ctl.resetAll}
        />
      )}
    </>
  );
}
