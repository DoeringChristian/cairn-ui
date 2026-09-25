import type { ReactNode } from "react";
import type { SettingsController } from "../../lib/card-settings";
import type { Scene3DSettings } from "../cards-settings/scene3d";
import { SettingsAction, SettingsSection, SettingsTabs, Switch } from "../settings/palette";
import { LayoutSection, SliderSection, bind, type MediaPanelCtx, type PanelSurface } from "./media-panel-kit";

export interface Scene3DPanelCtx extends MediaPanelCtx {
  /** The kind's own view controls (point size, colour by, wireframe, …). */
  viewSettings?: ReactNode;
  onResetCamera?: () => void;
}

/** Settings of the point cloud, mesh and 3D boxes cards. */
export default function Scene3DSettingsPanel({
  ctl,
  ctx,
  mode,
}: {
  ctl: SettingsController<Scene3DSettings>;
  ctx?: Scene3DPanelCtx;
  mode: PanelSurface;
}) {
  const card = mode === "card";
  const multi = !card || !!ctx?.multi;
  const data = <SliderSection ctl={ctl} ctx={ctx} />;
  const display = (
    <>
      <SettingsSection name="Appearance">
        {card && ctx?.viewSettings}
        {multi && <Switch {...bind(ctl, "syncCameras")} label="Sync cameras" description="Orbiting one pane moves them all." />}
        {card && ctx?.onResetCamera && <SettingsAction label="Reset camera" icon="fa-rotate-left" onClick={ctx.onResetCamera} />}
      </SettingsSection>
      <LayoutSection ctl={ctl} ctx={ctx} mode={mode} />
    </>
  );
  return <SettingsTabs tabs={{ data, display }} />;
}
