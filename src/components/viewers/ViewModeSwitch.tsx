/** A standalone viewer's "view as" switch (rendered / source, tree / raw…), shown when there is a choice. */
export default function ViewModeSwitch<M extends string>({
  modes,
  value,
  onChange,
  labels,
}: {
  modes: readonly M[];
  value: M;
  onChange: (mode: M) => void;
  labels?: Partial<Record<M, string>>;
}) {
  if (modes.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-1 text-xs" role="group" aria-label="view as" data-view-modes="">
      {modes.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={value === m}
          onClick={() => onChange(m)}
          className={`rounded border px-2 py-0.5 ${value === m ? "border-accent bg-accent/10 text-accent" : "border-border text-fg-muted hover:text-fg"}`}
        >
          {labels?.[m] ?? m}
        </button>
      ))}
    </div>
  );
}
