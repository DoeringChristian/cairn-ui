import { test } from "node:test";
import assert from "node:assert/strict";
import { allDirPaths, breadcrumbs, buildFileTree, findNode } from "./file-tree.ts";
import { diffFiles, diffMetadata, flattenMetadata, jsonEqual } from "./version-diff.ts";
import { defaultDownloadDir, usageSnippets, versionRef } from "./usage.ts";
import { aliasError, explorerPath, isBrowsableUri, isRemovableAlias, parseVersionSegment, tagError } from "./refs.ts";

const f = (path: string, size: number, digest: string | null = `d-${path}`, uri: string | null = null) => ({
  path, size, digest, uri, mime: null, object_type: null, etag: null,
});

// ---- file tree --------------------------------------------------------------

test("buildFileTree nests by path, dirs first, sums sizes and counts", () => {
  const root = buildFileTree([
    f("z.txt", 1),
    f("train/b.png", 20),
    f("train/a.png", 10),
    f("train/sub/c.bin", 5),
    f("raw.tar", 0, null, "s3://b/raw.tar"),
  ]);
  assert.deepEqual(root.children.map((c) => c.name), ["train", "raw.tar", "z.txt"]);
  assert.equal(root.size, 36); // the reference adds no bytes
  assert.equal(root.fileCount, 5);
  assert.equal(root.refCount, 1);
  const train = findNode(root, "train");
  assert.ok(train && train.kind === "dir");
  assert.deepEqual(train.children.map((c) => c.name), ["sub", "a.png", "b.png"]);
  assert.equal(train.size, 35);
  assert.equal(train.fileCount, 3);
  const sub = findNode(root, "train/sub");
  assert.ok(sub && sub.kind === "dir" && sub.size === 5 && sub.path === "train/sub");
  const c = findNode(root, "train/sub/c.bin");
  assert.ok(c && c.kind === "file" && c.entry.size === 5);
  assert.equal(findNode(root, "nope/x"), null);
  assert.deepEqual(allDirPaths(root), ["train", "train/sub"]);
});

test("breadcrumbs", () => {
  assert.deepEqual(breadcrumbs(""), [{ name: "root", path: "" }]);
  assert.deepEqual(breadcrumbs("a/b").map((b) => b.path), ["", "a", "a/b"]);
});

// ---- version diff -----------------------------------------------------------

test("flattenMetadata flattens objects, keeps arrays and empty objects as leaves", () => {
  const flat = flattenMetadata({ a: { b: 1, c: { d: "x" } }, e: [1, 2], g: {} });
  assert.deepEqual([...flat.entries()], [["a.b", 1], ["a.c.d", "x"], ["e", [1, 2]], ["g", {}]]);
});

test("diffMetadata classifies keys", () => {
  const rows = diffMetadata({ lr: 0.1, keep: 1, old: true, nest: { a: [1] } }, { lr: 0.2, keep: 1, nest: { a: [1] }, new: "x" });
  const by = Object.fromEntries(rows.map((r) => [r.key, r.status]));
  assert.deepEqual(by, { keep: "same", lr: "changed", "nest.a": "same", new: "added", old: "removed" });
  assert.ok(jsonEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
  assert.ok(!jsonEqual({ a: 1 }, { a: 1, b: 2 }));
});

test("diffFiles compares by path and digest, references by uri+etag", () => {
  const a = [f("same.txt", 1, "h1"), f("changed.txt", 1, "h2"), f("gone.txt", 1, "h3"), f("r", 0, null, "s3://x/1")];
  const b = [f("same.txt", 1, "h1"), f("changed.txt", 1, "h9"), f("new.txt", 1, "h4"), f("r", 0, null, "s3://x/2")];
  const d = diffFiles(a, b);
  assert.deepEqual(d.added.map((e) => e.path), ["new.txt"]);
  assert.deepEqual(d.removed.map((e) => e.path), ["gone.txt"]);
  assert.deepEqual(d.changed.map((e) => e.path), ["changed.txt", "r"]);
  assert.deepEqual(d.unchanged.map((e) => e.path), ["same.txt"]);
});

// ---- usage snippets ---------------------------------------------------------

const v = { name: "cifar10", type: "dataset", version: 3, project_id: "vision", aliases: ["latest", "best"], tags: ["clean"] };

test("usage snippets name this exact version and its entries", () => {
  const entries = [f("train/a.png", 10), f("labels.json", 2), f("raw.tar", 0, null, "s3://bucket/raw.tar")];
  const s = Object.fromEntries(usageSnippets(v, entries).map((x) => [x.id, x]));
  assert.match(s.use!.code, /with cairn\.Run\("vision"\) as run:\n {4}art = run\.use_artifact\("cifar10:v3"\)/);
  // More than one entry: get() needs a path.
  assert.match(s.get!.code, /art\.get\("train\/a\.png"\)/);
  assert.match(s.download!.code, /\.\/artifacts\/cifar10-v3\//);
  assert.match(s.download!.note, /CAIRN_ARTIFACT_DIR/);
  assert.match(s.file!.code, /art\.file\("train\/a\.png"\)/);
  // open() prefers a text entry, in text mode.
  assert.match(s.open!.code, /art\.open\("labels\.json", "r"\)/);
  assert.match(s.reader!.code, /cairn\.Reader\(\)\.artifact\("cifar10:v3", project="vision"\)/);
  const log = s.log!.code;
  assert.match(log, /cairn\.Artifact\("cifar10", type="dataset"\)/);
  assert.match(log, /add_dir\("path\/to\/train", name="train"\)/);
  assert.match(log, /add_file\("path\/to\/labels\.json"\)/);
  assert.match(log, /add_reference\("s3:\/\/bucket\/raw\.tar"\)/);
  assert.match(log, /new_file\("notes\.md"\)/);
  // User aliases only (latest moves by itself), and the version's tags.
  assert.match(log, /run\.log_artifact\(art, aliases=\["best"\], tags=\["clean"\]\)/);
  assert.match(s.log!.note, /cifar10:v4/);
});

test("a single-entry version's get() takes no path", () => {
  const s = usageSnippets({ ...v, aliases: ["latest"], tags: [] }, [{ ...f("ckpt.pkl", 9), object_type: "pickle" }]);
  const get = s.find((x) => x.id === "get")!;
  assert.equal(get.code, "value = art.get()");
  assert.match(get.note, /pickle/);
  assert.equal(s.find((x) => x.id === "open")!.code.includes('"rb"'), true);
  assert.match(s.find((x) => x.id === "log")!.code, /aliases=\["candidate"\]/);
});

test("refs from another project are qualified", () => {
  assert.equal(versionRef(v, "other"), "vision/cifar10:v3");
  assert.equal(versionRef(v, "vision"), "cifar10:v3");
  assert.equal(defaultDownloadDir(v), "./artifacts/cifar10-v3/");
});

// ---- refs -------------------------------------------------------------------

test("explorer paths and alias rules", () => {
  assert.equal(explorerPath("p"), "/p/p/artifacts");
  assert.equal(explorerPath("p", "my ckpt", 3, "files"), "/p/p/artifacts/my%20ckpt/v3/files");
  assert.equal(explorerPath("p", "a", 2, null, { compare: "1" }), "/p/p/artifacts/a/v2?compare=1");
  assert.equal(parseVersionSegment("v12"), 12);
  assert.equal(parseVersionSegment("latest"), null);
  assert.match(aliasError("latest")!, /reserved/);
  assert.match(aliasError("v3")!, /reserved/);
  assert.match(aliasError("a:b")!, /cannot contain/);
  assert.equal(aliasError("best"), null);
  assert.equal(aliasError("v3x"), null);
  assert.ok(tagError(" "));
  assert.equal(isRemovableAlias("latest"), false);
  assert.equal(isRemovableAlias("best"), true);
});

test("only http(s) URIs are links", () => {
  assert.equal(isBrowsableUri("https://x/y"), true);
  assert.equal(isBrowsableUri("s3://b/k"), false);
});
