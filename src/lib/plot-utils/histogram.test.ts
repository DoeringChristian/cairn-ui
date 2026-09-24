import { test } from "node:test";
import assert from "node:assert/strict";

import { computeHistogram, rebinHistograms } from "./histogram.ts";

test("computeHistogram bins uniformly and closes the last bin", () => {
  const h = computeHistogram([0, 1, 2, 3, 4, NaN], 4);
  assert.deepEqual(h.edges, [0, 1, 2, 3, 4]);
  assert.deepEqual(h.counts, [1, 1, 1, 2]);
});

test("computeHistogram widens a constant input", () => {
  const h = computeHistogram([2, 2], 2);
  assert.deepEqual(h.edges, [1.5, 2, 2.5]);
  assert.deepEqual(h.counts, [0, 2]);
});

test("rebinHistograms preserves mass on a shared grid", () => {
  const { edges, matrix } = rebinHistograms(
    [
      { counts: [4], edges: [0, 1] },
      { counts: [2, 2], edges: [1, 1.5, 2] },
    ],
    2,
  );
  assert.deepEqual(edges, [0, 1, 2]);
  assert.deepEqual(matrix, [[4, 0], [0, 4]]);
});
