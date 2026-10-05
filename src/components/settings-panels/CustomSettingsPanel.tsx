/**
 * Settings of a custom viewer card: which viewer (and version), the
 * viewer's own settings from its manifest, the slider, the pane layout and
 * the reference.
 *
 * The manifest's settings are ordinary card settings: each sits in the tab
 * and section its manifest names (default Display › Appearance), with its
 * label and help text, a reset to the default, and section/workspace
 * defaults — stored flat as `vs:<viewer>:<key>`, so defaults apply per
 * viewer and per setting. In the defaults editor (`mode: "defaults"`) a
 * viewer is picked first, and its settings' defaults are edited.
 */

import { useState } from "react";
import type { ViewerInfo } from "../../api/types";
import type { SettingsController } from "../../lib/card-settings";
import { COLORMAP_OPTIONS, type Colormap } from "../../charts/colormaps";
import type { CustomSettings } from "../cards-settings/custom";
import type { SteppedMediaPanelCtx } from "../media/SteppedMediaCard";
import {
  settingValues,
  storedViewerSettings,
  viewerSettingKey,
  type SeriesKind,
  type ViewerManifest,
  type ViewerSetting,
  type ViewerSettingSection,
  type ViewerSettingTab,
} from "../../lib/custom/manifest";
import { useViewer, useViewerDefaults, useViewerList, useViewerProject } from "../../lib/custom/hooks";
import { currentViewers, defaultViewerName, viewerFromInfo, viewersFor } from "../../lib/custom/viewers";
import { useProjectId } from "../../lib/project-context";
import { useCardEditorHost } from "../workspace/card-editor-host";
import { ExternalBaselinePicker } from "../card-kit/ExternalBaselinePicker";
import {
  ColormapSelect,
  NumberInput,
  Select,
  SettingRow,
  SettingsSection,
  SettingsTabs,
  Slider,
  Switch,
  TextInput,
  type SectionName,
  type SettingsTabId,
} from "../settings/palette";
import { LayoutSection, SliderSection, type PanelSurface } from "./media-panel-kit";
import { CARD_SECTIONS, initialTab, placeSettings } from "../../lib/custom/placement";

/** What a custom card's panel knows beyond the stepped media context. */
export interface CustomPanelCtx extends SteppedMediaPanelCtx {
  /** What the card's series are, to offer the viewers that accept them. */
  series: SeriesKind[];
}

const AUTO = "";

/** One manifest setting as a palette control. */
function ViewerSettingControl({
  setting,
  value,
  overridden,
  onChange,
  onReset,
  disabled,
}: {
  setting: ViewerSetting;
  value: string | number | boolean;
  overridden: boolean;
  onChange: (v: string | number | boolean) => void;
  onReset: () => void;
  disabled?: boolean;
}) {
  const row = { label: setting.label, description: setting.help, overridden, onReset, disabled };
  switch (setting.type) {
    case "slider":
      return (
        <Slider
          {...row}
          value={value as number}
          onChange={onChange}
          min={setting.min!}
          max={setting.max!}
          step={setting.step ?? (setting.max! - setting.min!) / 100}
          format={(v) => String(Math.round(v * 1000) / 1000)}
        />
      );
    case "number":
      return (
        <NumberInput
          {...row}
          value={value as number}
          onChange={(v) => onChange(v ?? (setting.default as number))}
          min={setting.min}
          max={setting.max}
          step={setting.step}
        />
      );
    case "switch":
      return <Switch {...row} value={value as boolean} onChange={onChange} />;
    case "select":
      return <Select {...row} value={value as string} onChange={onChange} options={setting.options!} />;
    case "colormap": {
      const known = COLORMAP_OPTIONS.some((o) => o.value === value);
      if (setting.options || !known) {
        const options = setting.options ?? COLORMAP_OPTIONS.map((o) => ({ value: o.value as string, label: o.label }));
        return <Select {...row} value={value as string} onChange={onChange} options={options} />;
      }
      return <ColormapSelect {...row} value={value as Colormap} onChange={onChange} />;
    }
    case "text":
      return <TextInput {...row} value={value as string} onChange={onChange} placeholder={setting.placeholder} />;
  }
}

/** The controls of a viewer's settings in one tab and section (manifest order). */
function ViewerControls({
  ctl,
  viewer,
  manifest,
  tab,
  section,
}: {
  ctl: SettingsController<CustomSettings>;
  viewer: string;
  manifest: ViewerManifest;
  tab: ViewerSettingTab;
  section: ViewerSettingSection;
}) {
  const settings = manifest.settings.filter((s) => s.tab === tab && s.section === section);
  if (settings.length === 0) return null;
  const values = settingValues(manifest.settings, storedViewerSettings(ctl.value as unknown as Record<string, unknown>, viewer));
  return (
    <>
      {settings.map((s) => {
        const key = viewerSettingKey(viewer, s.key) as `vs:${string}`;
        return (
          <ViewerSettingControl
            key={s.key}
            setting={s}
            value={values[s.key]!}
            overridden={ctl.isOverridden(key)}
            onChange={(v) => ctl.set({ [key]: v } as Partial<CustomSettings>, { mergeKey: key })}
            onReset={() => ctl.reset(key)}
            disabled={ctl.locked}
          />
        );
      })}
    </>
  );
}

/**
 * A viewer's settings, placed by tab and section. `own(tab, section)` gives
 * the controls of a section the card renders itself (so a manifest setting
 * in "Series" joins the card's Series section); `rest(tab, skip)` renders
 * the sections the card does not have, in manifest order.
 */
function viewerPlacement(ctl: SettingsController<CustomSettings>, viewer: string | null, manifest: ViewerManifest | null) {
  const has = (tab: ViewerSettingTab, section?: ViewerSettingSection) =>
    !!viewer && !!manifest?.settings.some((s) => s.tab === tab && (section == null || s.section === section));
  const own = (tab: ViewerSettingTab, section: ViewerSettingSection) =>
    has(tab, section) ? <ViewerControls ctl={ctl} viewer={viewer!} manifest={manifest!} tab={tab} section={section} /> : null;
  // Every setting has exactly one place (placement.ts): the card's own section of its name, else one of its own here.
  const placement = placeSettings(manifest ?? { settings: [] });
  const rest = (tab: ViewerSettingTab, skip: readonly ViewerSettingSection[] = CARD_SECTIONS[tab]) => {
    if (!viewer || !manifest) return null;
    const sections = placement[tab].filter((p) => !skip.includes(p.section)).map((p) => p.section);
    if (sections.length === 0) return null;
    return sections.map((section) => (
      <SettingsSection key={section} name={section as SectionName}>
        <ViewerControls ctl={ctl} viewer={viewer} manifest={manifest} tab={tab} section={section} />
      </SettingsSection>
    ));
  };
  return { has, own, rest, initialTab: initialTab(placement) as SettingsTabId };
}

function viewerLabel(v: ViewerInfo): string {
  const base = v.title || v.name;
  return v.dev ? `${base} (dev)` : `${base} · v${v.version ?? "?"}`;
}

export default function CustomSettingsPanel({
  ctl,
  ctx,
  mode,
}: {
  ctl: SettingsController<CustomSettings>;
  ctx?: CustomPanelCtx;
  mode: PanelSurface;
}) {
  if (mode === "defaults" || !ctx) return <DefaultsPanel ctl={ctl} mode={mode} />;
  return <CardPanel ctl={ctl} ctx={ctx} mode={mode} />;
}

function CardPanel({ ctl, ctx, mode }: { ctl: SettingsController<CustomSettings>; ctx: CustomPanelCtx; mode: PanelSurface }) {
  const ambient = useProjectId();
  const project = useViewerProject(ctx.runId) ?? ambient;
  const list = useViewerList(project).data ?? [];
  const s = ctl.value;
  const defaults = useViewerDefaults(project).data;
  const offered = ctx.series.length ? viewersFor(list, ctx.series) : currentViewers(list);
  // The kind's default viewer (lib/custom/viewers.ts defaultViewerName).
  const autoName = ctx.series.length ? defaultViewerName(defaults, list, ctx.series[0]!) : (offered[0]?.name ?? null);
  const auto = autoName ? list.find((v) => v.name === autoName) : undefined;
  const chosen = s.viewer ?? auto?.name ?? null;
  const resolved = useViewer(project, chosen, s.viewer_version ?? null);
  const manifest = resolved.viewer?.manifest ?? null;
  const versions = useViewerList(project, true).data?.filter((v) => v.name === chosen && !v.dev && !v.builtin) ?? [];
  const viewerOptions = [
    { value: AUTO, label: auto ? `Default (${auto.title || auto.name})` : "Default (none)" },
    ...offered.map((v) => ({ value: v.name, label: viewerLabel(v) })),
  ];
  if (s.viewer && !offered.some((v) => v.name === s.viewer)) viewerOptions.push({ value: s.viewer, label: `${s.viewer} (does not accept this data)` });
  const vs = viewerPlacement(ctl, chosen, manifest);
  // In the workspace's card editor the viewer is the card type (Default, or one viewer): picked there.
  const typePicksViewer = useCardEditorHost();
  const [tab, setTab] = useState<SettingsTabId | null>(null);

  const data = (
    <>
      <SettingsSection name="Series">
        {!typePicksViewer && (
        <Select
          value={s.viewer ?? AUTO}
          onChange={(v) => ctl.set({ viewer: v === AUTO ? undefined : v, viewer_version: undefined })}
          overridden={ctl.isOverridden("viewer")}
          onReset={() => ctl.reset("viewer")}
          disabled={ctl.locked}
          label="Viewer"
          description="Default follows the project's default viewer of this kind of data (Defaults page); pick a viewer to pin this card to it."
          options={viewerOptions}
        />
        )}
        {versions.length > 0 && (
          <Select
            value={s.viewer_version == null ? AUTO : String(s.viewer_version)}
            onChange={(v) => ctl.set({ viewer_version: v === AUTO ? undefined : Number(v) })}
            overridden={ctl.isOverridden("viewer_version")}
            onReset={() => ctl.reset("viewer_version")}
            disabled={ctl.locked}
            label="Version"
            description="Pin a published version; latest follows new publishes (and a running cairn viewer dev)."
            options={[{ value: AUTO, label: "latest" }, ...[...versions].sort((a, b) => (b.version ?? 0) - (a.version ?? 0)).map((v) => ({ value: String(v.version), label: `v${v.version}` }))]}
          />
        )}
        {resolved.viewer?.error && <p className="text-xs text-status-failed">{resolved.viewer.error}</p>}
        {offered.length === 0 && project && (
          <p className="text-xs text-fg-muted">
            No viewers in this project yet: <code className="mono">cairn viewer publish ./viewers/my-viewer --project {project}</code>
          </p>
        )}
        {vs.own("values", "Series")}
      </SettingsSection>
      <SliderSection ctl={ctl} ctx={ctx}>{vs.own("values", "Axes")}</SliderSection>
      {vs.rest("values")}
      <SettingsSection name="Compare">
        <SettingRow
          layout="stacked"
          label="Reference tag"
          description={manifest?.inputs === "compare" ? "The viewer gets each pane's value and this tag from the same run, as inputs A and B." : "Each pane shows this tag from its own run beside it."}
        >
          {s.reference && (
            <div className="mb-2 flex items-center gap-1 rounded border border-accent/40 bg-accent/5 px-2 py-1 text-xs text-fg-muted">
              <span className="mono min-w-0 flex-1 truncate">{s.reference.name}</span>
              <button type="button" onClick={() => ctl.set({ reference: undefined, referenceStep: undefined })} className="shrink-0 text-fg-subtle hover:text-fg" aria-label="Remove reference">
                ×
              </button>
            </div>
          )}
          <ExternalBaselinePicker
            runId={ctx.runId}
            objectType={ctx.series[0]?.object_type ?? "custom"}
            currentMetricName={ctx.metricName}
            selected={s.reference?.name}
            onSelect={(name) => ctl.set({ reference: { name } })}
          />
        </SettingRow>
        {s.reference && (
          <Switch
            value={s.referenceStep != null}
            onChange={(pinned) => ctl.set({ referenceStep: pinned ? ctx.currentStep : undefined })}
            overridden={ctl.isOverridden("referenceStep")}
            onReset={() => ctl.reset("referenceStep")}
            label="Pin reference step"
            description="Off follows the slider; on keeps the reference fixed."
          />
        )}
        {vs.own("values", "Compare")}
      </SettingsSection>
    </>
  );
  const display = (
    <>
      {vs.rest("display")}
      <LayoutSection ctl={ctl} modes ctx={ctx} mode={mode} paneKeys={ctx.paneKeys}>{vs.own("display", "Layout")}</LayoutSection>
    </>
  );
  // Open where the viewer's own settings are (most live under Display).
  return (
    <SettingsTabs
      active={tab ?? vs.initialTab}
      onActiveChange={setTab}
      tabs={{ values: data, grouping: vs.rest("grouping"), display, expressions: vs.rest("expressions") }}
    />
  );
}

/** The defaults editor: the shell's defaults, and per viewer its settings' defaults. */
function DefaultsPanel({ ctl, mode }: { ctl: SettingsController<CustomSettings>; mode: PanelSurface }) {
  const project = useProjectId();
  const list = currentViewers(useViewerList(project).data ?? []);
  const [picked, setPicked] = useState<string | null>(null);
  const info = list.find((v) => v.name === picked) ?? list[0] ?? null;
  const manifest = info ? viewerFromInfo(info).manifest : null;
  const vs = viewerPlacement(ctl, info?.name ?? null, manifest);
  const picker = list.length > 0 && (
    <SettingsSection name="Series">
      <Select
        value={info?.name ?? ""}
        onChange={(v) => setPicked(v)}
        label="Viewer"
        description="Defaults are kept per viewer: pick the viewer whose settings to set."
        options={list.map((v) => ({ value: v.name, label: v.title || v.name }))}
      />
      {vs.own("values", "Series")}
    </SettingsSection>
  );
  return (
    <SettingsTabs
      tabs={{
        values: (
          <>
            {picker}
            <SliderSection ctl={ctl}>{vs.own("values", "Axes")}</SliderSection>
            {vs.rest("values", list.length > 0 ? ["Series", "Axes"] : ["Axes"])}
          </>
        ),
        grouping: vs.rest("grouping"),
        display: (
          <>
            {vs.rest("display")}
            <LayoutSection ctl={ctl} modes mode={mode}>{vs.own("display", "Layout")}</LayoutSection>
          </>
        ),
        expressions: vs.rest("expressions"),
      }}
    />
  );
}
