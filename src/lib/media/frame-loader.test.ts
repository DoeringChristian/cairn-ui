import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AsyncCache,
  ForegroundGate,
  FrameSwitch,
  LoadAborted,
  LruCache,
  PrefetchQueue,
  prefetchOrder,
  stepDirection,
} from "./frame-loader.ts";

/** A promise settled from outside. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// --- LruCache -------------------------------------------------------------

test("lru evicts the least recently used entry past maxEntries", () => {
  const evicted: string[] = [];
  const c = new LruCache<number>({ maxEntries: 2, onEvict: (k) => evicted.push(k) });
  c.set("a", 1);
  c.set("b", 2);
  c.get("a"); // a is now newer than b
  c.set("c", 3);
  assert.deepEqual(c.keys(), ["a", "c"]);
  assert.deepEqual(evicted, ["b"]);
});

test("lru peek does not refresh recency", () => {
  const c = new LruCache<number>({ maxEntries: 2 });
  c.set("a", 1);
  c.set("b", 2);
  assert.equal(c.peek("a"), 1);
  c.set("c", 3);
  assert.deepEqual(c.keys(), ["b", "c"]);
});

test("lru evicts by weight but keeps the entry just set", () => {
  const c = new LruCache<number>({ maxEntries: 100, maxWeight: 10, weigh: (v) => v });
  c.set("a", 4);
  c.set("b", 4);
  c.set("c", 4); // 12 > 10 → a goes
  assert.deepEqual(c.keys(), ["b", "c"]);
  assert.equal(c.weight, 8);
  c.set("huge", 50); // heavier than the budget alone: kept, everything else goes
  assert.deepEqual(c.keys(), ["huge"]);
  assert.equal(c.weight, 50);
});

test("lru re-set replaces the weight", () => {
  const c = new LruCache<number>({ maxEntries: 10, weigh: (v) => v });
  c.set("a", 3);
  c.set("a", 5);
  assert.equal(c.weight, 5);
  assert.equal(c.size, 1);
  c.delete("a");
  assert.equal(c.weight, 0);
});

// --- AsyncCache -------------------------------------------------------------

test("async cache shares one in-flight load and peeks the settled value", async () => {
  const cache = new AsyncCache<string>(new LruCache({ maxEntries: 4 }));
  let calls = 0;
  const d = deferred<string>();
  const loader = () => { calls++; return d.promise; };
  const p1 = cache.load("k", loader);
  const p2 = cache.load("k", loader);
  assert.equal(calls, 1);
  assert.equal(cache.peek("k"), undefined);
  assert.equal(cache.isLoading("k"), true);
  d.resolve("v");
  assert.equal(await p1, "v");
  assert.equal(await p2, "v");
  assert.equal(cache.peek("k"), "v");
  assert.equal(await cache.load("k", loader), "v");
  assert.equal(calls, 1);
});

test("async cache forgets a failed load so the next call retries", async () => {
  const cache = new AsyncCache<string>(new LruCache({ maxEntries: 4 }));
  await assert.rejects(cache.load("k", async () => { throw new Error("boom"); }));
  assert.equal(cache.isLoading("k"), false);
  assert.equal(await cache.load("k", async () => "ok"), "ok");
});

test("async cache evicts settled values through its lru", async () => {
  const cache = new AsyncCache<number>(new LruCache({ maxEntries: 2 }));
  for (const k of ["a", "b", "c"]) await cache.load(k, async () => 1);
  assert.equal(cache.peek("a"), undefined);
  assert.equal(cache.peek("c"), 1);
});

// --- AsyncCache aborts -------------------------------------------------------

test("a load is aborted once every caller that asked for it has aborted", async () => {
  const cache = new AsyncCache<string>(new LruCache({ maxEntries: 4 }));
  let loaderSignal: AbortSignal | null = null;
  const d = deferred<string>();
  const loader = (sig: AbortSignal) => { loaderSignal = sig; return d.promise; };
  const a = new AbortController();
  const b = new AbortController();
  const pa = cache.load("k", loader, a.signal);
  const pb = cache.load("k", loader, b.signal);
  a.abort();
  await assert.rejects(pa, LoadAborted);
  assert.equal(loaderSignal!.aborted, false, "b still wants it");
  b.abort();
  await assert.rejects(pb, LoadAborted);
  assert.equal(loaderSignal!.aborted, true);
  assert.equal(cache.isLoading("k"), false);
  // A late result of the aborted load is not cached; the next call loads afresh.
  d.resolve("stale");
  await tick();
  assert.equal(cache.peek("k"), undefined);
  assert.equal(await cache.load("k", async () => "fresh"), "fresh");
});

test("a caller without a signal pins the load", async () => {
  const cache = new AsyncCache<string>(new LruCache({ maxEntries: 4 }));
  let loaderSignal: AbortSignal | null = null;
  const d = deferred<string>();
  const loader = (sig: AbortSignal) => { loaderSignal = sig; return d.promise; };
  const a = new AbortController();
  const pa = cache.load("k", loader, a.signal);
  const pinned = cache.load("k", loader);
  a.abort();
  await assert.rejects(pa, LoadAborted);
  assert.equal(loaderSignal!.aborted, false);
  d.resolve("v");
  assert.equal(await pinned, "v");
  assert.equal(cache.peek("k"), "v");
});

// --- FrameSwitch ------------------------------------------------------------

test("a ready frame switches in the request itself", () => {
  const s = new FrameSwitch<string>();
  assert.deepEqual(s.request("1", () => "one"), { key: "1", frame: "one" });
  assert.equal(s.pending, false);
  assert.equal(s.next(), null);
});

test("an unready frame keeps the held frame until it resolves", () => {
  const s = new FrameSwitch<string>();
  s.request("1", () => "one");
  assert.deepEqual(s.request("2", () => undefined), { key: "1", frame: "one" });
  assert.equal(s.pending, true);
  assert.equal(s.next(), "2");
  assert.equal(s.next(), null, "one load at a time");
  assert.equal(s.resolve("2", "two"), true);
  assert.deepEqual(s.shown, { key: "2", frame: "two" });
  assert.equal(s.pending, false);
});

test("scrubbing faster than loads: one load at a time, each newer frame shown, then the latest", () => {
  const s = new FrameSwitch<string>();
  s.request("1", () => "one");
  s.request("2", () => undefined);
  assert.equal(s.next(), "2");
  s.request("3", () => undefined);
  s.request("4", () => undefined);
  assert.equal(s.next(), null, "2 still running");
  assert.equal(s.obsolete(), null, "2 is newer than what is shown: let it finish");
  assert.equal(s.resolve("2", "two"), true, "an intermediate frame advances the pane");
  assert.equal(s.next(), "4", "then straight to the latest target");
  assert.equal(s.resolve("4", "four"), true);
  assert.deepEqual(s.shown, { key: "4", frame: "four" });
});

test("never out of order: a load requested before the frame on screen is dropped", () => {
  const s = new FrameSwitch<string>();
  s.request("1", () => "one");
  s.request("2", () => undefined);
  assert.equal(s.next(), "2");
  // The user moves on to a frame that is already decoded: it shows at once.
  s.request("3", () => "three");
  assert.equal(s.obsolete(), "2", "the running load is useless now");
  assert.equal(s.resolve("2", "two"), false);
  assert.deepEqual(s.shown, { key: "3", frame: "three" });
});

test("returning to the shown key makes the running load obsolete", () => {
  const s = new FrameSwitch<string>();
  s.request("1", () => "one");
  s.request("2", () => undefined);
  s.next();
  s.request("1", () => { throw new Error("must not peek the shown key"); });
  assert.equal(s.pending, false);
  assert.equal(s.obsolete(), "2");
  s.fail("2");
  assert.equal(s.loading, null);
  assert.deepEqual(s.shown, { key: "1", frame: "one" });
});

test("a failed load frees the slot for the latest target", () => {
  const s = new FrameSwitch<string>();
  s.request("1", () => undefined);
  assert.equal(s.next(), "1");
  s.request("2", () => undefined);
  s.fail("1");
  assert.equal(s.next(), "2");
});

test("a null request clears the pane at once", () => {
  const s = new FrameSwitch<string>();
  s.request("1", () => "one");
  assert.equal(s.request(null, () => "x"), null);
  assert.equal(s.shown, null);
  assert.equal(s.pending, false);
  assert.equal(s.resolve("1", "one"), false);
});

test("the first request has nothing to hold", () => {
  const s = new FrameSwitch<string>();
  assert.equal(s.request("1", () => undefined), null);
  assert.equal(s.pending, true);
});

// --- prefetch window --------------------------------------------------------

test("stepDirection", () => {
  assert.equal(stepDirection(null, 3), 0);
  assert.equal(stepDirection(3, 3), 0);
  assert.equal(stepDirection(2, 3), 1);
  assert.equal(stepDirection(4, 3), -1);
});

test("prefetch order standing still: nearest first, both sides, forward ties first", () => {
  assert.deepEqual(prefetchOrder(100, 50, { ahead: 3, behind: 1, direction: 0 }), [51, 49, 52, 48, 53, 47]);
});

test("prefetch order is biased toward the direction of travel", () => {
  assert.deepEqual(prefetchOrder(100, 50, { ahead: 4, behind: 2, direction: 1 }), [51, 49, 52, 48, 53, 54]);
  assert.deepEqual(prefetchOrder(100, 50, { ahead: 4, behind: 2, direction: -1 }), [49, 51, 48, 52, 47, 46]);
});

test("prefetch order clips at the ends and excludes the current index", () => {
  assert.deepEqual(prefetchOrder(5, 0, { ahead: 3, behind: 3, direction: -1 }), [1, 2, 3]);
  assert.deepEqual(prefetchOrder(5, 4, { ahead: 3, behind: 1, direction: 1 }), [3]);
  assert.deepEqual(prefetchOrder(1, 0, { ahead: 3, behind: 3, direction: 0 }), []);
});

// --- PrefetchQueue ----------------------------------------------------------

test("prefetch queue bounds concurrency, replaces the unstarted plan, aborts dropped runs", async () => {
  const q = new PrefetchQueue(2);
  const started: string[] = [];
  const gates = new Map<string, ReturnType<typeof deferred<void>>>();
  const signals = new Map<string, AbortSignal>();
  const task = (key: string) => ({
    key,
    run: (signal: AbortSignal) => {
      started.push(key);
      signals.set(key, signal);
      const d = deferred<void>();
      gates.set(key, d);
      return d.promise;
    },
  });
  q.plan(["a", "b", "c", "d"].map(task));
  assert.deepEqual(started, ["a", "b"]);
  assert.equal(q.queued, 2);
  // The slider moved: c/d are obsolete; b is running and kept, a is running and aborted.
  q.plan(["b", "x", "y"].map(task));
  assert.equal(signals.get("a")!.aborted, true);
  assert.equal(signals.get("b")!.aborted, false);
  assert.deepEqual(started, ["a", "b", "x"], "a's slot went to x");
  assert.equal(q.queued, 1);
  gates.get("b")!.reject(new Error("ignored"));
  await tick();
  assert.deepEqual(started, ["a", "b", "x", "y"]);
  assert.equal(q.running, 2);
  q.clear();
  assert.equal(signals.get("x")!.aborted, true);
  assert.equal(q.running, 0);
});

test("prefetching yields to foreground loads and resumes after them", async () => {
  const gate = new ForegroundGate();
  const q = new PrefetchQueue(2, gate);
  const started: string[] = [];
  const signals = new Map<string, AbortSignal>();
  const task = (key: string) => ({
    key,
    run: (signal: AbortSignal) => { started.push(key); signals.set(key, signal); return new Promise<void>(() => {}); },
  });
  const end = gate.begin();
  q.plan(["a", "b"].map(task));
  assert.deepEqual(started, [], "paused while a pane waits");
  end();
  assert.deepEqual(started, ["a", "b"]);
  const end2 = gate.begin();
  assert.equal(signals.get("a")!.aborted, true, "running prefetches step aside");
  assert.equal(q.running, 0);
  assert.equal(q.queued, 2, "and are requeued");
  end2();
  end2(); // idempotent
  assert.deepEqual(started, ["a", "b", "a", "b"]);
  assert.equal(gate.busy, false);
  q.dispose();
});
