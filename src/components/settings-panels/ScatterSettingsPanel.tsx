import { useMemo } from "react";
import {
  CheckList,
  FieldMultiPicker,
  NumberInput,
  RangeInput,
  Segmented,
  SettingsAction,
  SettingsSection,
  SettingsTabs,
  Switch,
  TextInput,
  type FieldOption,
} from "../settings/palette";
import { bind, type SettingsController } from "../../lib/card-settings";
import { checkTemplate, parseTemplate } from "../../lib/expr";
import type { Better } from "../../lib/plot-utils/pareto";
import { MAX_REF_LINES, type RefLine, type RunningStat } from "../../lib/plot-utils/scatter-extras";
import type { ScatterSettings } from "../cards-settings/scatter";
import { metaFor } from "../../lib/cards/settings-registry";
import ExprField from "./ExprField";

export interface PanelCtx {
  /** Picker options over the card's runs. */
  options: FieldOption[];
  /** Per-axis Pareto direction when unset (from the metric's summary rule). */
  paretoAuto: { x: Better; y: Better };
  /** Per expression: why it yields nothing (shown under the field). */
  errors: { x: string | null; y: string | null; color: string | null };
}

interface Props {
  ctl: SettingsController<ScatterSettings>;
  ctx?: PanelCtx;
  mode: "card" | "defaults";
}

const BETTER = [
  { value: "min" as const, label: "Lower" },
  { value: "max" as const, label: "Higher" },
];

const RUNNING = [
  { key: "min", label: "Running min" },
  { key: "max", label: "Running max" },
  { key: "mean", label: "Running mean" },
];

function templateError(src: string): string | null {
  if (!src.includes("${")) return null;
  try {
    checkTemplate(parseTemplate(src));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export default function ScatterSettingsPanel({ ctl, ctx, mode }: Props) {
  const s = ctl.value;
  const card = mode === "card";
  const cascade = useMemo(() => new Set<string>(metaFor("scatter").cascadeKeys), []);
  const show = (k: keyof ScatterSettings & string) => card || cascade.has(k);
  const options = ctx?.options ?? [];
  const ro = ctl.readOnly;

  const expr = (k: "x" | "y" | "color", label: string, clearable: boolean, info?: string) => (
    <ExprField
      label={label}
      info={info}
      value={s[k]?.src ?? null}
      onChange={(src) => ctl.set({ [k]: src == null ? null : { src } } as Partial<ScatterSettings>)}
      overridden={ctl.isOverridden(k)}
      onReset={() => ctl.reset(k)}
      disabled={ro}
      options={options}
      clearable={clearable}
      error={ctx?.errors[k]}
    />
  );

  const setRefLines = (next: RefLine[]) => ctl.set({ refLines: next });
  const refLines = s.refLines;

  const data = card && (
    <SettingsSection name="Axes">
      {expr("x", "X axis", false)}
      {expr("y", "Y axis", false)}
      {expr("color", "Colour", true, "Colour the points by this value on a colour scale; empty colours each run by its run colour.")}
      <RangeInput label="X range" {...bind(ctl, "xRange", { mergeKey: "xRange" })} />
      <RangeInput label="Y range" {...bind(ctl, "yRange", { mergeKey: "yRange" })} />
    </SettingsSection>
  );

  const display = (
    <>
      <SettingsSection name="Overlays">
        <Switch label="Pareto front" {...bind(ctl, "showPareto")} />
        {card && s.showPareto && (
          <>
            <Segmented<Better>
              label="X: better is"
              value={s.paretoX ?? ctx?.paretoAuto.x ?? "min"}
              onChange={(v) => ctl.set({ paretoX: v })}
              overridden={ctl.isOverridden("paretoX")}
              onReset={() => ctl.reset("paretoX")}
              disabled={ro}
              options={BETTER}
            />
            <Segmented<Better>
              label="Y: better is"
              value={s.paretoY ?? ctx?.paretoAuto.y ?? "min"}
              onChange={(v) => ctl.set({ paretoY: v })}
              overridden={ctl.isOverridden("paretoY")}
              onReset={() => ctl.reset("paretoY")}
              disabled={ro}
              options={BETTER}
            />
          </>
        )}
        <Switch
          label="Dim points off the front"
          {...bind(ctl, "dimNonFrontier")}
          disabled={ro || (card && !s.showPareto)}
        />
        <CheckList
          label="Running lines"
          description="Cumulative min / max / mean of Y as X grows."
          items={RUNNING}
          bulk={false}
          value={s.running}
          onChange={(v) => ctl.set({ running: v as RunningStat[] })}
          overridden={ctl.isOverridden("running")}
          onReset={() => ctl.reset("running")}
          disabled={ro}
        />
        <Switch
          label="Regression line"
          description="Least squares; fitted in log space on a log axis."
          {...bind(ctl, "regression")}
        />
        {card && (
          <>
            {refLines.map((l, i) => (
              <div key={i} className="my-1 rounded border border-border-subtle px-2">
                <Segmented<"x" | "y">
                  label={`Reference line ${i + 1}`}
                  value={l.axis}
                  onChange={(axis) => setRefLines(refLines.map((r, j) => (j === i ? { ...r, axis } : r)))}
                  disabled={ro}
                  options={[
                    { value: "x", label: "Vertical (x)" },
                    { value: "y", label: "Horizontal (y)" },
                  ]}
                />
                <NumberInput
                  label="At"
                  nullable={false}
                  value={l.value}
                  onChange={(v) => v != null && setRefLines(refLines.map((r, j) => (j === i ? { ...r, value: v } : r)))}
                  disabled={ro}
                />
                <TextInput
                  label="Label"
                  layout="inline"
                  placeholder="none"
                  value={l.label ?? ""}
                  onChange={(label) => setRefLines(refLines.map((r, j) => (j === i ? { ...r, label: label || undefined } : r)))}
                  disabled={ro}
                />
                <SettingsAction
                  label="Remove"
                  icon="fa-trash"
                  tone="danger"
                  disabled={ro}
                  onClick={() => setRefLines(refLines.filter((_, j) => j !== i))}
                />
              </div>
            ))}
            <SettingsAction
              label="Add reference line"
              icon="fa-plus"
              disabled={ro || refLines.length >= MAX_REF_LINES}
              description={refLines.length >= MAX_REF_LINES ? `At most ${MAX_REF_LINES}.` : undefined}
              onClick={() => setRefLines([...refLines, { axis: "y", value: 0 }])}
            />
          </>
        )}
      </SettingsSection>
      {card && (
        <SettingsSection name="Appearance">
          <TextInput
            label="Point label"
            mono
            placeholder="the run's name"
            info="A template: ${…} holds a scalar expression, e.g. ${run.name} lr=${config.lr}"
            error={templateError(s.labelTemplate)}
            {...bind(ctl, "labelTemplate", { mergeKey: "labelTemplate" })}
          />
          <FieldMultiPicker
            label="Tooltip fields"
            addLabel="Add field"
            options={options}
            {...bind(ctl, "tooltipFields")}
          />
          <ExprField
            label="Add a tooltip expression"
            adder
            options={options}
            value={null}
            disabled={ro}
            onChange={(src) =>
              src != null && !s.tooltipFields.includes(src) && ctl.set({ tooltipFields: [...s.tooltipFields, src] })
            }
          />
        </SettingsSection>
      )}
    </>
  );

  return <SettingsTabs tabs={{ data, display: (card || show("showPareto")) && display }} />;
}
