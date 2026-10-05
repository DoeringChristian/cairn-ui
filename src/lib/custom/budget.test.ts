/**
 * Viewer frames in the page's WebGL budget: each WebGL viewer frame is one
 * entry of weight 1 (lib/plot-utils/gl-budget.ts plans them with the Plotly
 * plots). Run: `npm run test:unit`.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { GL_CONTEXT_BUDGET, planBudget, Visibility, type BudgetEntry } from "../plot-utils/gl-budget.ts";
import { frameWeight } from "./budget.ts";

const frame = (id: number, o: Partial<BudgetEntry> = {}): BudgetEntry => ({
  id, weight: frameWeight({ webgl: true }), visibility: Visibility.Visible, pinned: false, live: false, lastUse: id, ...o,
});

test("frame weights: one context per WebGL frame; 2D viewers stay out", () => {
  assert.equal(frameWeight({ webgl: true }), 1);
  assert.equal(frameWeight({ webgl: false }), 0);
});

test("more visible frames than the budget: the most recent ones are live", () => {
  const entries = Array.from({ length: 14 }, (_, i) => frame(i + 1));
  const plan = planBudget(entries, GL_CONTEXT_BUDGET);
  assert.equal(plan.live.size, GL_CONTEXT_BUDGET);
  assert.ok(!plan.live.has(1) && plan.live.has(14));
});

test("a hovered paused frame resumes, the stalest live one pauses", () => {
  const entries = Array.from({ length: GL_CONTEXT_BUDGET }, (_, i) => frame(i + 1, { live: true }));
  entries.push(frame(99, { pinned: true, lastUse: 0 }));
  const plan = planBudget(entries, GL_CONTEXT_BUDGET);
  assert.deepEqual(plan.activate, [99]);
  assert.equal(plan.deactivate.length, 1);
  assert.equal(plan.deactivate[0], 1);
});

test("frames shared with Plotly plots: the total never exceeds the budget", () => {
  const plots = [{ id: 100, weight: 3, visibility: Visibility.Visible, pinned: false, live: true, lastUse: 50 }];
  const frames = Array.from({ length: 12 }, (_, i) => frame(i + 1, { visibility: i < 6 ? Visibility.Visible : Visibility.Away }));
  const all = [...plots, ...frames];
  const plan = planBudget(all, GL_CONTEXT_BUDGET);
  const used = all.filter((e) => plan.live.has(e.id)).reduce((n, e) => n + e.weight, 0);
  assert.ok(used <= GL_CONTEXT_BUDGET);
  for (let i = 1; i <= 6; i++) assert.ok(plan.live.has(i), `visible frame ${i} live`);
});
