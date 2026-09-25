import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ExprError,
  deps,
  evaluate,
  formatType,
  matches,
  parse,
  plan,
  renderTemplate,
  type RunContext,
  type SeriesData,
} from "./index.ts";

interface Case {
  expr?: string;
  template?: string;
  ctx: string;
  domain?: unknown;
  expected?: unknown;
  type?: string;
  warnings?: Array<{ kind: string; span: [number, number] }>;
  plan?: string;
  deps?: unknown;
  error?: { message: string; span: [number, number] };
}

const doc = JSON.parse(
  readFileSync(new URL("../../../docs/schemas/expr-vectors.json", import.meta.url), "utf8"),
) as { contexts: Record<string, unknown>; cases: Case[] };

/** `{"$f": "nan"|"inf"|"-inf"}` → the float, recursively. */
function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.$f === "string") return o.$f === "nan" ? NaN : o.$f === "inf" ? Infinity : -Infinity;
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

function makeCtx(name: string): RunContext {
  const c = decode(doc.contexts[name]) as {
    run: Record<string, unknown>;
    config: Record<string, unknown>;
    summary: Record<string, unknown>;
    series: Record<string, SeriesData>;
    stats?: Record<string, Record<string, number>>;
  };
  return {
    series: (n) => c.series[n] ?? null,
    stat: c.stats ? (n, r) => c.stats![n]?.[r] : undefined,
    config: (k) => c.config[k],
    summary: (k) => c.summary[k],
    run: (f) => c.run[f],
  };
}

/** Deep equality with floats at relative tolerance 1e-12 (NaN equals NaN). */
function close(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
    if (a === b) return true;
    return Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b));
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => close(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return (
      close(ka, kb) &&
      ka.every((k) => close((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
    );
  }
  return a === b;
}

function label(c: Case): string {
  return c.expr !== undefined ? `expr ${JSON.stringify(c.expr)} @${c.ctx}` : `template ${JSON.stringify(c.template)}`;
}

test("expr-vectors.json has 150+ cases", () => {
  assert.ok(doc.cases.length >= 150, String(doc.cases.length));
});

test("expr-vectors.json: every case matches", () => {
  for (const c of doc.cases) {
    const ctx = makeCtx(c.ctx);
    try {
      if (c.template !== undefined) {
        const got = renderTemplate(c.template, ctx);
        assert.ok(!c.error, `${label(c)}: expected an error, got ${JSON.stringify(got)}`);
        assert.equal(got, c.expected, label(c));
        continue;
      }
      const node = parse(c.expr!);
      const r = evaluate(node, ctx, c.domain ? { domain: decode(c.domain) as SeriesData } : {});
      assert.ok(!c.error, `${label(c)}: expected an error`);
      const got =
        r.value.kind === "scalar" ? { scalar: r.value.value } : { steps: r.value.steps, values: r.value.values };
      assert.ok(close(got, decode(c.expected)), `${label(c)}: got ${JSON.stringify(got)}`);
      assert.equal(formatType(r.type), c.type, `${label(c)} type`);
      assert.deepEqual(
        r.warnings.map((w) => ({ kind: w.kind, span: [w.span.start, w.span.end] })),
        c.warnings,
        `${label(c)} warnings`,
      );
      assert.equal(plan(node), c.plan, `${label(c)} plan`);
      assert.deepEqual(deps(node), c.deps, `${label(c)} deps`);
    } catch (e) {
      if (!(e instanceof ExprError)) throw e;
      assert.ok(c.error, `${label(c)}: unexpected error ${e.message}`);
      assert.equal(e.message, c.error.message, label(c));
      assert.deepEqual([e.span.start, e.span.end], c.error.span, `${label(c)} span`);
    }
  }
});

test("matches: scalar, non-null, Python-truthy", () => {
  const ctx = makeCtx("base");
  assert.equal(matches(evaluate('config.optimizer == "adam"', ctx)), true);
  assert.equal(matches(evaluate("config.missing", ctx)), false);
  assert.equal(matches(evaluate("null < 1", ctx)), false);
  assert.equal(matches(evaluate("config.layers", ctx)), true);
  assert.equal(matches(evaluate("loss > 0", ctx)), false);
});

test("stat is consulted only for a bare metric under a reducer", () => {
  const calls: string[] = [];
  const ctx: RunContext = {
    series: () => ({ steps: [0, 1], values: [3, 4] }),
    stat: (n, r) => {
      calls.push(`${r}(${n})`);
      return undefined;
    },
    config: () => null,
    summary: () => null,
    run: () => null,
  };
  const r = evaluate("last(loss) + min(loss * 2)", ctx);
  assert.deepEqual(r.value, { kind: "scalar", value: 10 });
  assert.deepEqual(calls, ["last(loss)"]);
});
