/**
 * The runs table's filter and group-by bar. The filter is a tree (lib/
 * run-filter.ts): and/or groups over builder chips and expression leaves.
 * The root's conditions show as removable chips; "Filter" opens the tree
 * editor, where groups nest and toggle between AND and OR. Group-by is a
 * list of levels (nested groups), each a run field, a param or an
 * expression. State lives with the page; this only edits it.
 */

import { useRef, useState } from "react";
import {
  OPERATORS,
  addChild,
  exprLeafError,
  isEmptyFilter,
  updateAt,
  type FilterNode,
  type GroupNode,
  type NodePath,
  type Operator,
  type RunFilter,
  type RunsFilterState,
} from "../lib/run-filter.ts";
import { compileScalarExpr } from "../lib/runs-table/columns.ts";
import { groupByLabel, type GroupBy } from "../lib/runs-table/group.ts";
import Popover from "./ui/Popover";

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

function chipText(f: RunFilter): string {
  if (f.op === "isnull") return `${f.field} ${f.arg.toLowerCase() === "false" ? "is not null" : "is null"}`;
  return `${f.field} ${OP_LABELS[f.op].replace(/ \(.*\)$/, "")} ${f.arg}`;
}

/** One line of text for any node (groups in parentheses). */
function nodeText(n: FilterNode): string {
  switch (n.kind) {
    case "chip":
      return chipText(n);
    case "expr":
      return n.expr;
    case "group":
      return n.children.length === 0
        ? "(empty)"
        : `(${n.children.map(nodeText).join(n.op === "and" ? " and " : " or ")})`;
  }
}

const SMALL_BTN =
  "inline-flex items-center gap-1 rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] text-fg-muted hover:border-accent hover:text-fg disabled:opacity-40 touch:min-h-9";

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
  const groupBtnRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const root = state.filter;
  const setRoot = (filter: GroupNode) => onChange({ ...state, filter });

  const count = root.children.length;
  return (
    <>
      {root.children.map((c, i) => (
        <span
          key={`${i}:${nodeText(c)}`}
          className={`mono inline-flex max-w-[24rem] items-center gap-1 rounded border px-1.5 py-0.5 text-xs text-fg ${
            c.kind === "expr" && exprLeafError(c.expr)
              ? "border-status-failed/60 bg-status-failed/10"
              : "border-accent/40 bg-accent/10"
          }`}
          title={nodeText(c)}
        >
          {i > 0 && <span className="text-fg-subtle">{root.op}</span>}
          <span className="truncate">{nodeText(c)}</span>
          <button
            type="button"
            onClick={() => setRoot(updateAt(root, [i], () => null))}
            className="text-fg-subtle hover:text-status-failed"
            aria-label={`Remove filter ${nodeText(c)}`}
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
        <i className="fa-solid fa-filter mr-1 text-[10px]" aria-hidden="true" />
        Filter{count > 0 ? ` (${count})` : ""}
      </button>
      {!isEmptyFilter(root) && (
        <button type="button" className="text-xs text-fg-subtle hover:text-fg" onClick={() => setRoot({ ...root, children: [] })}>
          Clear filters
        </button>
      )}
      <button
        ref={groupBtnRef}
        type="button"
        className="btn max-w-[20rem] truncate px-2 py-1 text-xs"
        onClick={() => setGroupOpen((v) => !v)}
        aria-expanded={groupOpen}
        title={state.groupBy.map(groupByLabel).join(" › ") || "Group rows"}
      >
        <i className="fa-solid fa-layer-group mr-1 text-[10px]" aria-hidden="true" />
        {state.groupBy.length === 0 ? "Group" : `Group: ${state.groupBy.map(groupByLabel).join(" › ")}`}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={btnRef} title="Filter runs" titleAnchored width={520} align="start" bodyClassName="p-3">
        <GroupEditor node={root} path={[]} root={root} fields={fields} onRoot={setRoot} />
      </Popover>
      <Popover open={groupOpen} onClose={() => setGroupOpen(false)} anchorRef={groupBtnRef} title="Group rows by" titleAnchored width={360} align="start" bodyClassName="p-3">
        <GroupByEditor levels={state.groupBy} paramKeys={paramKeys} onChange={(groupBy) => onChange({ ...state, groupBy })} />
      </Popover>
    </>
  );
}

// ---------------------------------------------------------------------------
// The filter tree editor
// ---------------------------------------------------------------------------

function GroupEditor({
  node,
  path,
  root,
  fields,
  onRoot,
}: {
  node: GroupNode;
  path: NodePath;
  root: GroupNode;
  fields: string[];
  onRoot: (next: GroupNode) => void;
}) {
  const [adding, setAdding] = useState<"chip" | "expr" | null>(null);
  const edit = (p: NodePath, fn: (n: FilterNode) => FilterNode | null) => onRoot(updateAt(root, p, fn));
  const nested = path.length > 0;
  return (
    <div className={`flex flex-col gap-1.5 ${nested ? "rounded border border-border-subtle bg-bg-elevated/60 p-2" : ""}`}>
      <div className="flex items-center gap-2 text-[11px] text-fg-muted">
        <span>Match</span>
        <span className="inline-flex overflow-hidden rounded border border-border" role="group" aria-label="Combine with">
          {(["and", "or"] as const).map((op) => (
            <button
              key={op}
              type="button"
              aria-pressed={node.op === op}
              onClick={() => edit(path, (n) => (n.kind === "group" ? { ...n, op } : n))}
              className={`px-2 py-0.5 touch:min-h-9 ${node.op === op ? "bg-accent text-white" : "bg-bg hover:text-fg"}`}
            >
              {op === "and" ? "all (AND)" : "any (OR)"}
            </button>
          ))}
        </span>
        {nested && (
          <button type="button" className="ml-auto text-fg-subtle hover:text-status-failed" onClick={() => edit(path, () => null)} aria-label="Remove group">
            {"×"} group
          </button>
        )}
      </div>
      {node.children.length === 0 && <p className="text-[11px] italic text-fg-subtle">No conditions: every run matches.</p>}
      {node.children.map((c, i) => {
        const p = [...path, i];
        if (c.kind === "group") {
          return <GroupEditor key={i} node={c} path={p} root={root} fields={fields} onRoot={onRoot} />;
        }
        if (c.kind === "expr") {
          return <ExprRow key={`${i}:${c.expr}`} expr={c.expr} onChange={(expr) => edit(p, () => ({ kind: "expr", expr }))} onRemove={() => edit(p, () => null)} />;
        }
        return (
          <div key={i} className="mono flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-xs">
            <span className="min-w-0 flex-1 truncate" title={chipText(c)}>{chipText(c)}</span>
            <button type="button" className="text-fg-subtle hover:text-status-failed" onClick={() => edit(p, () => null)} aria-label={`Remove filter ${chipText(c)}`}>
              {"×"}
            </button>
          </div>
        );
      })}
      {adding === "chip" && (
        <ChipForm
          fields={fields}
          onAdd={(chip) => {
            onRoot(addChild(root, path, { kind: "chip", ...chip }));
            setAdding(null);
          }}
          onCancel={() => setAdding(null)}
        />
      )}
      {adding === "expr" && (
        <NewExprForm
          onAdd={(expr) => {
            onRoot(addChild(root, path, { kind: "expr", expr }));
            setAdding(null);
          }}
          onCancel={() => setAdding(null)}
        />
      )}
      <div className="flex flex-wrap gap-1">
        <button type="button" className={SMALL_BTN} onClick={() => setAdding("chip")}>+ Condition</button>
        <button type="button" className={SMALL_BTN} onClick={() => setAdding("expr")}>+ Expression</button>
        <button
          type="button"
          className={SMALL_BTN}
          onClick={() => onRoot(addChild(root, path, { kind: "group", op: node.op === "and" ? "or" : "and", children: [] }))}
        >
          + Group
        </button>
      </div>
    </div>
  );
}

function ExprRow({ expr, onChange, onRemove }: { expr: string; onChange: (e: string) => void; onRemove: () => void }) {
  const [draft, setDraft] = useState(expr);
  const error = exprLeafError(draft);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <span className="mono text-[10px] text-fg-subtle" title="Expression">ƒ</span>
        <input
          className={`input mono min-w-0 flex-1 py-0.5 text-xs ${error ? "border-status-failed" : ""}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== expr && onChange(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft !== expr) onChange(draft);
          }}
          aria-label="Filter expression"
        />
        <button type="button" className="text-fg-subtle hover:text-status-failed" onClick={onRemove} aria-label={`Remove filter ${expr}`}>
          {"×"}
        </button>
      </div>
      {error && <p className="pl-4 text-[10px] text-status-failed">{error} (ignored until fixed)</p>}
    </div>
  );
}

function NewExprForm({ onAdd, onCancel }: { onAdd: (expr: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState("");
  const error = draft.trim() ? exprLeafError(draft) : null;
  return (
    <form
      className="flex flex-col gap-1 rounded border border-border-subtle p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim() && !error) onAdd(draft.trim());
      }}
    >
      <input
        className={`input mono text-xs ${error ? "border-status-failed" : ""}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="min(val.loss) < 0.3 and config.opt == 'adam'"
        autoFocus
        aria-label="New filter expression"
      />
      <p className={`text-[10px] ${error ? "text-status-failed" : "text-fg-subtle"}`}>
        {error ?? "Reducers over metrics (min, max, mean, first, last), config.<key>, summary.<key>, run.<field>."}
      </p>
      <div className="flex justify-end gap-1">
        <button type="button" className={SMALL_BTN} onClick={onCancel}>Cancel</button>
        <button type="submit" className={SMALL_BTN} disabled={!draft.trim() || !!error}>Add</button>
      </div>
    </form>
  );
}

function ChipForm({ fields, onAdd, onCancel }: { fields: string[]; onAdd: (f: RunFilter) => void; onCancel: () => void }) {
  const [field, setField] = useState("");
  const [op, setOp] = useState<Operator>("exact");
  const [arg, setArg] = useState("");
  const chosenField = field || fields[0] || "";
  return (
    <form
      className="flex flex-wrap items-center gap-1 rounded border border-border-subtle p-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        if (!chosenField) return;
        onAdd({ field: chosenField, op, arg: op === "isnull" ? (arg || "true") : arg });
      }}
    >
      <select className="input w-auto max-w-[11rem] py-0.5 text-xs" value={chosenField} onChange={(e) => setField(e.target.value)} aria-label="Field">
        {fields.map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
      <select
        className="input w-auto py-0.5 text-xs"
        value={op}
        aria-label="Operator"
        onChange={(e) => {
          const next = e.target.value as Operator;
          if ((next === "isnull") !== (op === "isnull")) setArg("");
          setOp(next);
        }}
      >
        {OPERATORS.map((o) => (
          <option key={o} value={o}>{OP_LABELS[o]}</option>
        ))}
      </select>
      {op === "isnull" ? (
        <select className="input w-auto py-0.5 text-xs" value={arg || "true"} onChange={(e) => setArg(e.target.value)} aria-label="Value">
          <option value="true">is null</option>
          <option value="false">is not null</option>
        </select>
      ) : (
        <input
          className="input mono w-28 py-0.5 text-xs"
          value={arg}
          onChange={(e) => setArg(e.target.value)}
          placeholder={op === "in" ? "a,b,c" : "value"}
          title="Numbers and true/false are typed; anything else is text."
          aria-label="Value"
          autoFocus
        />
      )}
      <span className="ml-auto flex gap-1">
        <button type="button" className={SMALL_BTN} onClick={onCancel}>Cancel</button>
        <button type="submit" className={SMALL_BTN} disabled={!chosenField}>Add</button>
      </span>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Group-by levels
// ---------------------------------------------------------------------------

function GroupByEditor({ levels, paramKeys, onChange }: { levels: GroupBy[]; paramKeys: string[]; onChange: (next: GroupBy[]) => void }) {
  const [source, setSource] = useState("group");
  const [expr, setExpr] = useState("");
  const exprError = source === "expr" && expr.trim() ? compileScalarExpr(expr).error : null;
  const add = () => {
    let level: GroupBy | null = null;
    if (source === "group" || source === "job_type" || source === "tag") level = { source };
    else if (source.startsWith("param:")) level = { source: "param", key: source.slice("param:".length) };
    else if (source === "expr" && expr.trim() && !exprError) level = { source: "expr", expr: expr.trim() };
    if (!level) return;
    onChange([...levels, level]);
    setExpr("");
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= levels.length) return;
    const next = [...levels];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2 text-xs">
      {levels.length === 0 && <p className="text-[11px] italic text-fg-subtle">Not grouped.</p>}
      {levels.map((g, i) => (
        <div key={i} className="flex items-center gap-1" style={{ paddingLeft: i * 12 }}>
          <span className="text-fg-subtle">{i === 0 ? "by" : "then"}</span>
          <span className="mono min-w-0 flex-1 truncate rounded border border-border-subtle bg-bg-elevated px-1.5 py-0.5" title={groupByLabel(g)}>
            {groupByLabel(g)}
          </span>
          <button type="button" className="px-1 text-fg-subtle hover:text-fg disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
          <button type="button" className="px-1 text-fg-subtle hover:text-fg disabled:opacity-30" disabled={i === levels.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
          <button type="button" className="px-1 text-fg-subtle hover:text-status-failed" onClick={() => onChange(levels.filter((_, k) => k !== i))} aria-label={`Remove ${groupByLabel(g)}`}>
            {"×"}
          </button>
        </div>
      ))}
      <form
        className="flex flex-col gap-1 border-t border-border-subtle pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className="flex items-center gap-1">
          <select className="input min-w-0 flex-1 py-0.5 text-xs" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Group by">
            <option value="group">group</option>
            <option value="job_type">job_type</option>
            <option value="tag">tag</option>
            {paramKeys.map((k) => (
              <option key={k} value={`param:${k}`}>{`param: ${k}`}</option>
            ))}
            <option value="expr">expression…</option>
          </select>
          <button type="submit" className={SMALL_BTN} disabled={source === "expr" && (!expr.trim() || !!exprError)}>
            + Level
          </button>
        </div>
        {source === "expr" && (
          <>
            <input
              className={`input mono text-xs ${exprError ? "border-status-failed" : ""}`}
              value={expr}
              onChange={(e) => setExpr(e.target.value)}
              placeholder="min(val.loss) < 0.3"
              aria-label="Group expression"
              autoFocus
            />
            {exprError && <p className="text-[10px] text-status-failed">{exprError}</p>}
          </>
        )}
      </form>
    </div>
  );
}
