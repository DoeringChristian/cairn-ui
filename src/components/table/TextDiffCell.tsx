import { useMemo } from "react";
import { diffCell, type TextDiffMode } from "../../lib/table/text-diff";

interface Props {
  /** The reference value (removed parts come from it). */
  before: unknown;
  after: unknown;
  mode: TextDiffMode;
}

/** A text cell diffed against its reference: removed runs struck through in red, added runs in green. */
export default function TextDiffCell({ before, after, mode }: Props) {
  const parts = useMemo(() => diffCell(before, after, mode), [before, after, mode]);
  return (
    <span className="mono">
      {parts.map((p, i) =>
        p.op === "same" ? (
          <span key={i}>{p.value}</span>
        ) : p.op === "del" ? (
          <del key={i} className="rounded-sm bg-red-900/30 text-fg-muted decoration-red-400">
            {p.value}
          </del>
        ) : (
          <ins key={i} className="rounded-sm bg-green-900/30 text-fg no-underline">
            {p.value}
          </ins>
        ),
      )}
    </span>
  );
}
