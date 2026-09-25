import { useMemo, useState } from "react";
import {
  toSplitRows,
  toUnifiedRows,
  type FileText,
  type LineOp,
  type SkipRow,
  type SplitCell,
} from "../../lib/source-diff";

export type DiffLayout = "split" | "unified";

interface Props {
  left: FileText;
  right: FileText;
  leftLabel: string;
  rightLabel: string;
  path: string;
  layout: DiffLayout;
  /** Unchanged lines kept around each change; `null` shows the whole file. */
  context: number | null;
}

const OP_CLS: Record<LineOp, string> = {
  context: "text-fg-muted",
  add: "bg-green-500/15 text-fg",
  del: "bg-red-500/15 text-fg",
};
const OP_MARK: Record<LineOp, string> = { context: " ", add: "+", del: "-" };
const GUTTER = "select-none w-10 shrink-0 pr-2 text-right text-fg-subtle tabular-nums";

/** One file's two versions as a diff; unchanged stretches fold to "⋯ N unchanged lines". */
export default function DiffView({ left, right, leftLabel, rightLabel, path, layout, context }: Props) {
  // Clicking a fold shows the whole file (until the file or pair changes).
  const [fullFor, setFullFor] = useState<string | null>(null);
  const fileKey = `${leftLabel}|${rightLabel}|${path}`;
  const ctx = context == null || fullFor === fileKey ? Infinity : context;
  const unified = useMemo(() => (layout === "unified" ? toUnifiedRows(left, right, ctx) : null), [layout, left, right, ctx]);
  const split = useMemo(() => (layout === "split" ? toSplitRows(left, right, ctx) : null), [layout, left, right, ctx]);
  const diff = unified ?? split!;

  if (diff.binary) return <p className="text-sm text-fg-muted">Binary file — cannot display diff.</p>;

  const fold = (r: SkipRow, i: number) => (
    <button
      key={`skip-${i}`}
      type="button"
      onClick={() => setFullFor(fileKey)}
      className="block w-full bg-bg-hover/50 px-2 py-0.5 text-left text-fg-subtle hover:text-fg"
      title="Show the whole file"
    >
      ⋯ {r.count} unchanged line{r.count === 1 ? "" : "s"}
    </button>
  );

  return (
    <div className="text-xs">
      <div className="mb-2 mono text-fg-muted flex flex-wrap items-baseline gap-x-3">
        <span className="text-red-400">--- {leftLabel}/{path}</span>
        <span className="text-green-400">+++ {rightLabel}/{path}</span>
        <span className="ml-auto tabular-nums">
          <span className="text-green-400">+{diff.added}</span> <span className="text-red-400">−{diff.removed}</span>
        </span>
      </div>
      {diff.rows.length === 0 ? (
        <p className="text-fg-subtle">Empty file.</p>
      ) : unified ? (
        <div className="mono">
          {unified.rows.map((r, i) =>
            r.kind === "skip" ? (
              fold(r, i)
            ) : (
              <div key={i} className={`flex ${OP_CLS[r.op]}`}>
                <span className={GUTTER}>{r.aLine ?? ""}</span>
                <span className={GUTTER}>{r.bLine ?? ""}</span>
                <span className="whitespace-pre-wrap break-all">
                  {OP_MARK[r.op]}
                  {r.text}
                </span>
              </div>
            ),
          )}
        </div>
      ) : (
        <div className="mono">
          {split!.rows.map((r, i) =>
            r.kind === "skip" ? (
              fold(r, i)
            ) : (
              <div key={i} className="grid grid-cols-2 gap-px">
                <SplitSide cell={r.left} />
                <SplitSide cell={r.right} />
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function SplitSide({ cell }: { cell: SplitCell | null }) {
  if (!cell) return <div className="bg-bg-hover/30" />;
  return (
    <div className={`flex min-w-0 ${OP_CLS[cell.op]}`}>
      <span className={GUTTER}>{cell.line}</span>
      <span className="min-w-0 whitespace-pre-wrap break-all">
        {OP_MARK[cell.op]}
        {cell.text}
      </span>
    </div>
  );
}
