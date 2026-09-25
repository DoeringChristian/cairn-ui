import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compileScalarExpr,
  evalScalar,
  metricExpr,
  paramExpr,
  planScalarExprs,
  quoteMetric,
  reducerForRule,
  ruleDirection,
  runContext,
  scalarFieldOptions,
  templateSrcs,
  toNumber,
  validateScalarExpr,
} from "./scalar-exprs.ts";
import { parse } from "./expr/index.ts";
import type { RunDetailResponse } from "../api/types.ts";

function detail(over: Partial<RunDetailResponse["run"]> = {}, extra: Partial<RunDetailResponse> = {}): RunDetailResponse {
  return {
    run: {
      id: "r1",
      project_id: "p",
      display_name: "alpha",
      created_at: "2026-01-01T00:00:00",
      ended_at: null,
      status: "completed",
      exit_code: 0,
      git_sha: null,
      git_dirty: null,
      git_branch: null,
      cli_args: null,
      env_snapshot: null,
      hostname: null,
      user: null,
      tags: '["a","b"]',
      notes: null,
      git_remote: null,
      parent_run_id: null,
      fork_step: null,
      data_epoch: 0,
      group: "g1",
      job_type: null,
      sweep_id: null,
      stop_requested: null,
      stats: {
        "val.loss": { count: 3, first: 3, last: 1.5, min: 1, max: 3, mean: 2, first_step: 0, last_step: 2, rule: "min" },
        acc: { count: 3, first: 0.1, last: 0.9, min: 0.1, max: 0.9, mean: 0.5, first_step: 0, last_step: 2, rule: null },
        "train/loss": { count: 1, first: 4, last: 4, min: 4, max: 4, mean: 4, first_step: 0, last_step: 0, rule: "max" },
      },
      ...over,
    },
    params: [
      { key: "lr", value: "0.01", value_type: "float" },
      { key: "opt.name", value: '"adam"', value_type: "str" },
    ],
    summary: [{ key: "best", value: "0.95", value_type: "float" }],
    ...extra,
  };
}

test("plan: reducers over metrics need no series; anything else fetches them", () => {
  const p = planScalarExprs(["config.lr", "min(val.loss)", "last(acc) - first(acc)", "max(ema(acc, 0.5))", "mean(acc * 2)"]);
  assert.deepEqual(p.compiled.map((c) => c.plan), ["stats", "stats", "stats", "series", "series"]);
  assert.deepEqual(p.seriesMetrics, ["acc"]);
});

test("compile: parse errors and series results are errors", () => {
  assert.match(compileScalarExpr("min(").error ?? "", /./);
  assert.match(validateScalarExpr("val.loss") ?? "", /series.*last\(val\.loss\)/);
  assert.equal(validateScalarExpr("  "), "empty expression");
  assert.equal(validateScalarExpr("max(val.loss) / config.lr"), null);
});

test("evaluate from stats alone", () => {
  const ctx = runContext(detail(), new Map());
  const v = (src: string) => evalScalar(compileScalarExpr(src), ctx).value;
  assert.equal(v("min(val.loss)"), 1);
  assert.equal(v("last(acc) - first(acc)"), 0.9 - 0.1);
  assert.equal(v("config.lr"), 0.01);
  assert.equal(v("config.opt.name"), "adam");
  assert.equal(v("summary.best"), 0.95);
  assert.equal(v("run.group"), "g1");
  assert.equal(v("run.name"), "alpha");
  assert.equal(v('"a" in run.tags'), true);
  assert.equal(v("max(`train/loss`)"), 4);
  // No stats entry: the run has no value for that metric.
  assert.equal(v("last(missing)"), null);
});

test("evaluate over fetched series; fetched series win over stats", () => {
  const series = new Map([["acc", { steps: [0, 1, 2], values: [0.2, 0.4, 0.6] }]]);
  const ctx = runContext(detail(), series);
  assert.equal(evalScalar(compileScalarExpr("last(acc)"), ctx).value, 0.6);
  const r = evalScalar(compileScalarExpr("max(ema(acc, 0))"), ctx);
  assert.equal(r.value, 0.6);
  assert.equal(r.error, null);
});

test("an invalid expression evaluates to null with its error", () => {
  const r = evalScalar(compileScalarExpr("nope("), runContext(detail(), new Map()));
  assert.equal(r.value, null);
  assert.ok(r.error);
});

test("quoting: picked names parse back to the same metric / key", () => {
  for (const name of ["loss", "val.loss", "train/loss", "step", "in", "config.x", "a..b", "layer.0.w", "we`ird"]) {
    const node = parse(quoteMetric(name));
    assert.equal(node.type, "metric", name);
    assert.equal((node as { name: string }).name, name);
  }
  for (const key of ["lr", "opt.name", "model/depth", "a..b"]) {
    const node = parse(paramExpr(key));
    assert.equal(node.type, "config");
    assert.equal((node as { key: string }).key, key);
  }
  assert.equal(metricExpr("val.loss", "min"), "min(val.loss)");
  assert.equal(metricExpr("train/loss", "last"), "last(`train/loss`)");
});

test("field options: params, metrics by their rule, summary keys", () => {
  const opts = scalarFieldOptions([detail(), undefined]);
  assert.deepEqual(
    opts.map((o) => [o.kind, o.key]),
    [
      ["param", "config.lr"],
      ["param", "config.opt.name"],
      ["metric", "last(acc)"],
      ["metric", "max(`train/loss`)"],
      ["metric", "min(val.loss)"],
      ["metric", "summary.best"],
    ],
  );
  assert.equal(reducerForRule("mean"), "mean");
  assert.equal(reducerForRule(null), "last");
});

test("rule direction: one metric with a min/max rule", () => {
  const rules: Record<string, string> = { "val.loss": "min", acc: "max" };
  const of = (m: string) => rules[m];
  assert.equal(ruleDirection("min(val.loss)", of), "min");
  assert.equal(ruleDirection("last(acc) * 100", of), "max");
  assert.equal(ruleDirection("config.lr", of), null);
  assert.equal(ruleDirection("last(acc) - min(val.loss)", of), null);
});

test("template holes and numbers", () => {
  assert.deepEqual(templateSrcs("${run.name} (${min(val.loss)})"), ["run.name", "min(val.loss)"]);
  assert.deepEqual(templateSrcs("plain"), []);
  assert.deepEqual(templateSrcs("${oops"), []);
  assert.equal(toNumber(true), 1);
  assert.equal(toNumber("3"), null);
  assert.equal(toNumber(NaN), null);
});
