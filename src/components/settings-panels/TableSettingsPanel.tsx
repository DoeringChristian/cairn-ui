import type { SettingsController } from "../../lib/card-settings";
import { AGG_FNS, type AggFn, type TableAgg, type TableGroupBy } from "../../lib/table/pipeline";
import { TEXT_DIFF_MODES } from "../../lib/table/text-diff";
import type { TableCombine, TableCombineSource, TableSettings } from "../cards-settings/table";
import { DEFAULT_ROWS_PER_PAGE } from "../cards-settings/table";
import {
  CheckList,
  FieldMultiPicker,
  FieldPicker,
  NumberInput,
  Segmented,
  Select,
  SettingRow,
  SettingsAction,
  SettingsSection,
  SettingsTabs,
  Switch,
  type Bound,
  type FieldOption,
} from "../settings/palette";
import DerivedColumnsEditor from "../table/DerivedColumnsEditor";

/** One series of the card a combine can take a table from. */
export interface TableSourceOption {
  runId: string;
  name: string;
  /** Pane / legend label (the run, plus the series when the card has several names). */
  label: string;
  color?: string;
  /** Steps with a logged table. */
  steps: number[];
}

export interface TablePanelCtx {
  /** Columns the operations see: the logged table's plus derived ones. */
  inputColumns: string[];
  /** Derived column names (listed as expressions in the pickers). */
  derivedColumns: string[];
  /** Columns of the table shown (after group-by): the visibility list. */
  outputColumns: string[];
  /** Several panes side by side (multi-run, no combine). */
  multi: boolean;
  /** Whether diff colours are on when the card has no override. */
  diffDefault: boolean;
  sources: TableSourceOption[];
  derivedErrors?: ReadonlyArray<string | null>;
  groupByError?: string | null;
  /** The join key used when `combine.on` is unset (null = by position). */
  autoJoinKey?: string | null;
}

interface Props {
  ctl: SettingsController<TableSettings>;
  ctx?: TablePanelCtx;
  mode: "card" | "defaults";
}

function bind<K extends keyof TableSettings & string>(
  ctl: SettingsController<TableSettings>,
  k: K,
): Bound<TableSettings[K]> {
  return {
    value: ctl.value[k],
    onChange: (v) => ctl.set({ [k]: v } as Partial<TableSettings>),
    overridden: ctl.isOverridden(k),
    onReset: () => ctl.reset(k),
    disabled: ctl.readOnly,
  };
}

const sourceKey = (s: { runId: string; name: string }) => `${s.runId}::${s.name}`;

const AGG_LABEL: Record<AggFn, string> = {
  count: "count",
  sum: "sum",
  mean: "mean",
  min: "min",
  max: "max",
  first: "first",
  nunique: "unique count",
};

function CombineEditor({ ctl, ctx }: { ctl: SettingsController<TableSettings>; ctx: TablePanelCtx }) {
  const combine = ctl.value.combine;
  const setCombine = (patch: Partial<TableCombine>) => ctl.set({ combine: { ...combine, ...patch } });
  const disabled = ctl.readOnly;
  // No sources yet: the card's series at the slider's step.
  const sources: TableCombineSource[] =
    combine.sources.length > 0
      ? combine.sources
      : ctx.sources.map((s) => ({ runId: s.runId, name: s.name, step: "slider" as const }));
  const setSources = (next: TableCombineSource[]) => setCombine({ sources: next });
  const byKey = new Map(ctx.sources.map((s) => [sourceKey(s), s]));
  const sourceOptions = ctx.sources.map((s) => ({ value: sourceKey(s), label: s.label }));
  const shown = combine.mode === "join" ? sources.slice(0, 2) : sources;

  return (
    <>
      <Segmented
        label="Tables"
        description={
          combine.mode === "none"
            ? "One pane per series."
            : combine.mode === "concat"
              ? "Stacked into one table; a source column says where each row came from."
              : "The first two sources joined on a key column; clashing columns get _1 / _2."
        }
        value={combine.mode}
        onChange={(mode) => setCombine({ mode })}
        overridden={ctl.isOverridden("combine")}
        onReset={() => ctl.reset("combine")}
        disabled={disabled}
        options={[
          { value: "none", label: "Panes" },
          { value: "concat", label: "Concat" },
          { value: "join", label: "Join" },
        ]}
      />
      {combine.mode !== "none" && (
        <>
          {shown.map((s, i) => {
            const opt = byKey.get(sourceKey(s));
            const stepOptions = [
              { value: "slider", label: "Slider step" },
              ...(opt?.steps ?? []).map((st) => ({ value: String(st), label: `step ${st}` })),
            ];
            const stepValue = s.step === "slider" ? "slider" : String(s.step);
            if (s.step !== "slider" && !stepOptions.some((o) => o.value === stepValue)) {
              stepOptions.push({ value: stepValue, label: `step ${s.step}` });
            }
            const replace = (patch: Partial<TableCombineSource>) =>
              setSources(sources.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <SettingRow key={i} label={combine.mode === "join" ? (i === 0 ? "Left" : "Right") : `Source ${i + 1}`} layout="stacked" disabled={disabled}>
                <div className="flex items-center gap-1.5">
                  {opt?.color && (
                    <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: opt.color }} />
                  )}
                  <div className="min-w-0 flex-1">
                    <Select
                      layout="stacked"
                      value={sourceKey(s)}
                      onChange={(k) => {
                        const o = byKey.get(k);
                        if (o) replace({ runId: o.runId, name: o.name });
                      }}
                      disabled={disabled}
                      options={opt ? sourceOptions : [...sourceOptions, { value: sourceKey(s), label: `${s.name} (not in card)` }]}
                    />
                  </div>
                  <div className="w-28 shrink-0">
                    <Select
                      layout="stacked"
                      value={stepValue}
                      onChange={(v) => replace({ step: v === "slider" ? "slider" : Number(v) })}
                      disabled={disabled}
                      options={stepOptions}
                    />
                  </div>
                  {sources.length > 1 && (
                    <button
                      type="button"
                      className="shrink-0 px-1 text-xs text-fg-muted hover:text-status-failed disabled:cursor-not-allowed"
                      aria-label="Remove source"
                      title="Remove source"
                      disabled={disabled}
                      onClick={() => setSources(sources.filter((_, j) => j !== i))}
                    >
                      <i className="fa-solid fa-xmark" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </SettingRow>
            );
          })}
          {(combine.mode === "concat" || shown.length < 2) && ctx.sources.length > 0 && (
            <SettingsAction
              label="Add source"
              icon="fa-plus"
              description="Another series, or the same table at another step."
              disabled={disabled}
              onClick={() => {
                const first = ctx.sources[0]!;
                setSources([...sources, { runId: first.runId, name: first.name, step: "slider" }]);
              }}
            />
          )}
          {combine.mode === "join" && (
            <>
              <Select
                label="Join"
                value={combine.how ?? "inner"}
                onChange={(how) => setCombine({ how })}
                disabled={disabled}
                options={[
                  { value: "inner", label: "Inner (both)" },
                  { value: "left", label: "Left (all left)" },
                  { value: "outer", label: "Outer (all rows)" },
                ]}
              />
              <FieldPicker
                label="Key column"
                description={combine.on ? undefined : "Automatic: a shared id-like first column, else rows by position."}
                value={combine.on ?? null}
                onChange={(on) => setCombine({ on: on ?? undefined })}
                clearable
                placeholder={ctx.autoJoinKey ? `auto (${ctx.autoJoinKey})` : "auto (by position)"}
                disabled={disabled}
                options={ctx.inputColumns.map((c) => ({ key: c, kind: "metric" as const, label: c }))}
              />
            </>
          )}
        </>
      )}
    </>
  );
}

function GroupByEditor({ ctl, ctx }: { ctl: SettingsController<TableSettings>; ctx: TablePanelCtx }) {
  const ops = ctl.value.ops;
  const gb: TableGroupBy = ops.groupBy ?? { keys: [], aggs: [] };
  const disabled = ctl.readOnly;
  const setGroupBy = (next: TableGroupBy) =>
    ctl.set({ ops: { ...ops, groupBy: next.keys.length === 0 && next.aggs.length === 0 ? null : next } });
  const derived = new Set(ctx.derivedColumns);
  const options: FieldOption[] = ctx.inputColumns.map((c) => ({
    key: c,
    kind: derived.has(c) ? "expr" : "metric",
    label: c,
  }));
  const setAgg = (i: number, patch: Partial<TableAgg>) =>
    setGroupBy({ ...gb, aggs: gb.aggs.map((a, j) => (j === i ? { ...a, ...patch } : a)) });

  return (
    <>
      <FieldMultiPicker
        label="Group by"
        description="Rows with equal values in these columns become one row."
        value={gb.keys}
        onChange={(keys) => setGroupBy({ ...gb, keys })}
        addLabel="Add key"
        disabled={disabled}
        options={options}
        error={ctx.groupByError}
      />
      {gb.aggs.map((a, i) => (
        <SettingRow key={i} label={i === 0 ? "Aggregates" : undefined} layout="stacked" disabled={disabled}>
          <div className="flex items-center gap-1.5">
            <div className="w-28 shrink-0">
              <Select
                layout="stacked"
                value={a.fn}
                onChange={(fn) => setAgg(i, { fn })}
                disabled={disabled}
                options={AGG_FNS.map((fn) => ({ value: fn, label: AGG_LABEL[fn] }))}
              />
            </div>
            <div className="min-w-0 flex-1">
              <FieldPicker
                value={a.column === "" || a.column === "*" ? null : a.column}
                onChange={(c) => setAgg(i, { column: c ?? "" })}
                clearable={a.fn === "count"}
                placeholder={a.fn === "count" ? "rows" : "column…"}
                disabled={disabled}
                options={options}
              />
            </div>
            <button
              type="button"
              className="shrink-0 px-1 text-xs text-fg-muted hover:text-status-failed disabled:cursor-not-allowed"
              aria-label="Remove aggregate"
              title="Remove aggregate"
              disabled={disabled}
              onClick={() => setGroupBy({ ...gb, aggs: gb.aggs.filter((_, j) => j !== i) })}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
        </SettingRow>
      ))}
      <SettingsAction
        label="Add aggregate"
        icon="fa-plus"
        disabled={disabled}
        description={gb.aggs.length === 0 ? "count, sum, mean, min, max, first or unique count of a column per group." : undefined}
        onClick={() =>
          setGroupBy({
            ...gb,
            aggs: [...gb.aggs, gb.aggs.length === 0 && gb.keys.length > 0 ? { column: "", fn: "count" } : { column: "", fn: "mean" }],
          })
        }
      />
    </>
  );
}

/** Settings of the table card (also the defaults editor's, with `mode="defaults"`). */
export default function TableSettingsPanel({ ctl, ctx, mode }: Props) {
  const s = ctl.value;
  const card = mode === "card" && ctx !== undefined;

  const display = (
    <>
      <SettingsSection name="Layout">
        <NumberInput
          label="Rows per page"
          description="Client-side pagination size."
          {...bind(ctl, "rowsPerPage")}
          onChange={(v) => ctl.set({ rowsPerPage: v ?? DEFAULT_ROWS_PER_PAGE })}
          min={1}
          step={10}
          integer
          nullable={false}
        />
        {card && ctx.outputColumns.length > 0 && (
          <CheckList
            label="Columns"
            value={ctx.outputColumns.filter((c) => !s.hiddenColumns.includes(c))}
            onChange={(visible) => {
              const shown = new Set(visible);
              // Hidden columns not in the current table stay hidden.
              const keep = s.hiddenColumns.filter((c) => !ctx.outputColumns.includes(c));
              ctl.set({ hiddenColumns: [...keep, ...ctx.outputColumns.filter((c) => !shown.has(c))] });
            }}
            overridden={ctl.isOverridden("hiddenColumns")}
            onReset={() => ctl.reset("hiddenColumns")}
            disabled={ctl.readOnly}
            items={ctx.outputColumns.map((c) => ({ key: c, label: c }))}
          />
        )}
      </SettingsSection>
      <SettingsSection name="Compare">
        {card && ctx.multi && (
          <>
            <Switch
              label="Diff colors"
              description="Tint numeric cells by whether they are the highest or lowest across the compared tables."
              value={s.diffMode ?? ctx.diffDefault}
              onChange={(v) => ctl.set({ diffMode: v })}
              overridden={ctl.isOverridden("diffMode")}
              onReset={() => ctl.reset("diffMode")}
              disabled={ctl.readOnly}
            />
            <Switch
              label="Invert colors"
              description="Green for lower values (e.g. a loss)."
              value={s.invertDiffColors ?? false}
              onChange={(v) => ctl.set({ invertDiffColors: v })}
              overridden={ctl.isOverridden("invertDiffColors")}
              onReset={() => ctl.reset("invertDiffColors")}
              disabled={ctl.readOnly}
            />
          </>
        )}
        <Segmented
          label="Text diff"
          layout="stacked"
          description="Text cells that differ from the first table (or, joined, x_2 from x_1) show what changed."
          {...bind(ctl, "textDiff")}
          options={[{ value: "off", label: "Off" }, ...TEXT_DIFF_MODES.map((m) => ({ value: m, label: m[0]!.toUpperCase() + m.slice(1) }))]}
        />
      </SettingsSection>
    </>
  );

  if (!card) return <SettingsTabs tabs={{ display }} />;

  return (
    <SettingsTabs
      tabs={{
        data: (
          <SettingsSection name="Compare">
            <CombineEditor ctl={ctl} ctx={ctx} />
          </SettingsSection>
        ),
        grouping: <GroupByEditor ctl={ctl} ctx={ctx} />,
        display,
        expressions: (
          <DerivedColumnsEditor
            value={s.ops.derived ?? []}
            onChange={(derived) => ctl.set({ ops: { ...s.ops, derived } })}
            errors={ctx.derivedErrors}
            columns={ctx.inputColumns.filter((c) => !ctx.derivedColumns.includes(c))}
            disabled={ctl.readOnly}
          />
        ),
      }}
    />
  );
}
