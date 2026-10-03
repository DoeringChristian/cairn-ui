import CodeBlock from "./CodeBlock";

/**
 * A pickled Python object: browsers cannot unpickle it, so this says what it
 * is (the SDK's recorded type) and, when given, how to load it in Python.
 */
export default function PickleInfo({ meta, loadSnippet }: { meta: Record<string, unknown> | null; loadSnippet?: string }) {
  const m = meta ?? {};
  const type = typeof m.python_type === "string" ? m.python_type : null;
  const module = typeof m.python_module === "string" && m.python_module !== "builtins" ? m.python_module : null;
  const rest = Object.entries(m).filter(([k]) => k !== "python_type" && k !== "python_module");
  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-bg px-4 py-3 text-sm" data-viewer="pickle">
      <p>
        A pickled Python object
        {type && (
          <>
            {" "}
            of type <code className="mono">{module ? `${module}.${type}` : type}</code>
          </>
        )}
        . Browsers cannot unpickle it{loadSnippet ? "; load it in Python:" : "."}
      </p>
      {loadSnippet && <CodeBlock code={loadSnippet} />}
      {rest.length > 0 && (
        <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-0.5 text-xs">
          {rest.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="mono break-all">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
