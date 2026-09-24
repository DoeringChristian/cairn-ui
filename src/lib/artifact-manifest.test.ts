import { test } from "node:test";
import assert from "node:assert/strict";
import { isBrowsableUri, manifestTree } from "./artifact-manifest.ts";

test("manifestTree nests paths, directories before files", () => {
  const tree = manifestTree([
    { path: "z.txt", hash: "h1", size: 1, mime: "text/plain" },
    { path: "train/b.bin", hash: "h2", size: 2, mime: "application/octet-stream" },
    { path: "train/a.txt", hash: "h3", size: 3, mime: "text/plain" },
    { path: "raw.tar", uri: "s3://b/raw.tar" },
  ]);
  assert.deepEqual(tree.map((n) => n.name), ["train", "raw.tar", "z.txt"]);
  const train = tree[0]!;
  assert.equal(train.kind, "dir");
  assert.deepEqual(train.kind === "dir" ? train.children.map((c) => c.name) : [], ["a.txt", "b.bin"]);
});

test("only http(s) URIs are links", () => {
  assert.equal(isBrowsableUri("https://x/y"), true);
  assert.equal(isBrowsableUri("s3://b/k"), false);
});
