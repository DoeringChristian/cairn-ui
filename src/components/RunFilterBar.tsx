/**
 * The runs table's filter chips, "+ Filter" builder and group-by select.
 * State lives with the page (it filters and groups the rows); this only edits
 * it. Semantics are in lib/run-filter.ts.
 */

import { useRef, useState } from "react";
import {
  OPERATORS,
  type GroupBy,
  type Operator,
  type RunFilter,
  type RunsFilterState,
} from "../lib/run-filter.ts";
import SettingsPopover from "./SettingsPopover";

const OP_LABELS: Record<Operator, string> = {
  exact: "=",
  iexact: "= (any case)",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  in: "in (a,b,…)",
  contains: "contains",
  icontains: "contains (any case)",
  startswith: "starts with",
  endswith: "ends with",
  isnull: "is null",
};

function groupByValue(g: GroupBy | null): string {
  if (!g) return "none";
  return g.source === "param" ? `param:${g.key}` : g.source;
}

function parseGroupBy(v: string): GroupBy | null {
  if (v === "group" || v === "job_type" || v === "tag") return { source: v };
  if (v.startsWith("param:")) return { source: "param", key: v.slice("param:".length) };
  return null;
}

function chipText(f: RunFilter): string {
  if (f.op === "isnull") return `${f.field} ${f.arg.toLowerCase() === "false" ? "is not null" : "is null"}`;
  return `${f.field} ${OP_LABELS[f.op].replace(/ \(.*\)$/, "")} ${f.arg}`;
}

interface Props {
  /** Filterable fields (see `filterFieldsOf`). */
  fields: string[];
  /** Param keys offered as group-by sources. */
  paramKeys: string[];
  state: RunsFilterState;
  onChange: (next: RunsFilterState) => void;
}

export default function RunFilterBar({ fields, paramKeys, state, onChange }: Props) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [field, setField] = useState("");
  const [op, setOp] = useState<Operator>("exact");
  const [arg, setArg] = useState("");

  const chosenField = field || fields[0] || "";
  const add = () => {
    if (!chosenField) return;
    const next: RunFilter = { field: chosenField, op, arg: op === "isnull" ? (arg || "true") : arg };
    onChange({ ...state, filters: [...state.filters, next] });
    setArg("");
    setOpen(false);
  };
  const remove = (i: number) => onChange({ ...state, filters: state.filters.filter((_, k) => k !== i) });

  const groupBy = groupByValue(state.groupBy);
  const paramOptions = state.groupBy?.source === "param" && !paramKeys.includes(state.groupBy.key)
    ? [...paramKeys, state.groupBy.key]
    : paramKeys;

  return (
    <>
      {state.filters.map((f, i) => (
        <span
          key={`${i}:${f.field}:${f.op}:${f.arg}`}
          className="mono inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-xs text-fg"
        >
          {chipText(f)}
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-fg-subtle hover:text-status-failed"
            aria-label={`Remove filter ${chipText(f)}`}
          >
            {"×"}
          </button>
        </span>
      ))}
      <button
        ref={btnRef}
        type="button"
        className="btn px-2 py-1 text-xs"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        + Filter
      </button>
      {state.filters.length > 1 && (
        <button
          type="button"
          className="text-xs text-fg-subtle hover:text-fg"
          onClick={() => onChange({ ...state, filters: [] })}
        >
          Clear filters
        </button>
      )}
      <label className="flex items-center gap-1 text-xs text-fg-muted">
        Group by
        <select
          className="input py-1 text-xs"
          value={groupBy}
          onChange={(e) => onChange({ ...state, groupBy: parseGroupBy(e.target.value) })}
        >
          <option value="none">none</option>
          <option value="group">group</option>
          <option value="job_type">job_type</option>
          <option value="tag">tag</option>
          {paramOptions.map((k) => (
            <option key={k} value={`param:${k}`}>{`param: ${k}`}</option>
          ))}
        </select>
      </label>
      <SettingsPopover open={open} onClose={() => setOpen(false)} anchorRef={btnRef} title="Add filter">
        <form
          className="flex flex-col gap-2 text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <label className="flex flex-col gap-1 text-fg-muted">
            Field
            <select className="input text-xs" value={chosenField} onChange={(e) => setField(e.target.value)}>
              {fields.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-fg-muted">
            Operator
            <select className="input text-xs" value={op} onChange={(e) => {
                const next = e.target.value as Operator;
                if ((next === "isnull") !== (op === "isnull")) setArg("");
                setOp(next);
              }}>
              {OPERATORS.map((o) => (
                <option key={o} value={o}>{OP_LABELS[o]}</option>
              ))}
            </select>
          </label>
          {op === "isnull" ? (
            <label className="flex flex-col gap-1 text-fg-muted">
              Value
              <select className="input text-xs" value={arg || "true"} onChange={(e) => setArg(e.target.value)}>
                <option value="true">is null</option>
                <option value="false">is not null</option>
              </select>
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-fg-muted">
              Value
              <input
                className="input mono text-xs"
                value={arg}
                onChange={(e) => setArg(e.target.value)}
                placeholder={op === "in" ? "a,b,c" : "value"}
                title="Numbers and true/false are typed; anything else is text."
                autoFocus
              />
            </label>
          )}
          <button type="submit" className="btn self-end px-2 py-1 text-xs" disabled={!chosenField}>
            Add
          </button>
        </form>
      </SettingsPopover>
    </>
  );
}
