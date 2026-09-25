import { useMemo, useState } from "react";
import { FIELD_KIND_LABEL, filterFields, type FieldKind, type FieldOption } from "./logic";

export const KIND_BADGE: Record<FieldKind, { text: string; title: string }> = {
  param: { text: "P", title: "Param" },
  metric: { text: "M", title: "Metric" },
  expr: { text: "ƒ", title: "Expression" },
};

export function KindBadge({ kind }: { kind: FieldKind }) {
  const b = KIND_BADGE[kind];
  return (
    <span
      title={b.title}
      className="mono inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-bg-hover text-[10px] text-fg-subtle"
    >
      {b.text}
    </span>
  );
}

interface Props {
  options: readonly FieldOption[];
  /** Keys to leave out (already chosen). */
  exclude?: ReadonlySet<string>;
  /** Highlighted as the current choice. */
  selected?: string | null;
  onPick: (option: FieldOption) => void;
  /** Offer the `.*` toggle; with `onPickAll`, "Add all N" for the matches. */
  regexToggle?: boolean;
  onPickAll?: (matches: FieldOption[]) => void;
}

/** The searchable, kind-grouped list inside FieldPicker / FieldMultiPicker popovers. */
export default function FieldList({ options, exclude, selected, onPick, regexToggle, onPickAll }: Props) {
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [cursor, setCursor] = useState(0);
  const { groups, matches, error } = useMemo(
    () => filterFields(options, query, regex, exclude),
    [options, query, regex, exclude],
  );
  const at = Math.min(cursor, Math.max(0, matches.length - 1));

  let index = -1;
  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-border-subtle bg-bg-elevated p-2">
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor(Math.min(at + 1, matches.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor(Math.max(at - 1, 0));
              } else if (e.key === "Enter" && matches[at]) {
                e.preventDefault();
                onPick(matches[at]);
              }
            }}
            placeholder={regex ? "Regex, e.g. ^val/.*loss$" : "Search…"}
            aria-label="Search fields"
            aria-invalid={!!error}
            className={`input py-1 ${regex ? "mono" : ""} ${error ? "!border-status-failed" : ""}`}
          />
          {regexToggle && (
            <button
              type="button"
              aria-pressed={regex}
              onClick={() => setRegex((v) => !v)}
              title="Regular expression"
              className={[
                "mono h-7 shrink-0 rounded border px-1.5 text-xs touch:h-10 touch:px-3",
                regex ? "border-accent bg-accent/10 text-accent" : "border-border bg-bg text-fg-muted hover:text-fg",
              ].join(" ")}
            >
              .*
            </button>
          )}
        </div>
        {error && <p className="mt-1 text-xs text-status-failed">{error}</p>}
        {onPickAll && regex && query.trim() && matches.length > 0 && (
          <button
            type="button"
            onClick={() => onPickAll(matches)}
            className="mt-1.5 w-full rounded border border-border bg-bg px-2 py-1 text-left text-xs text-accent hover:bg-bg-hover touch:min-h-10"
          >
            Add all {matches.length} matches
          </button>
        )}
      </div>
      <div role="listbox" className="py-1">
        {matches.length === 0 && <div className="px-3 py-2 text-xs text-fg-subtle">No matching fields</div>}
        {groups.map((g) => (
          <div key={g.kind} role="group" aria-label={FIELD_KIND_LABEL[g.kind]}>
            <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
              {FIELD_KIND_LABEL[g.kind]}
            </div>
            {g.options.map((o) => {
              index += 1;
              const i = index;
              return (
                <button
                  key={o.key}
                  type="button"
                  role="option"
                  aria-selected={o.key === selected}
                  onClick={() => onPick(o)}
                  onMouseMove={() => i !== at && setCursor(i)}
                  className={[
                    "flex w-full items-center gap-2 px-3 py-1 text-left text-xs touch:min-h-10",
                    i === at ? "bg-bg-hover" : "",
                    o.key === selected ? "text-accent" : "text-fg-muted hover:text-fg",
                  ].join(" ")}
                >
                  <KindBadge kind={o.kind} />
                  <span className="mono min-w-0 flex-1 truncate">{o.label}</span>
                  {o.key === selected && <i aria-hidden="true" className="fa-solid fa-check text-[10px]" />}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
