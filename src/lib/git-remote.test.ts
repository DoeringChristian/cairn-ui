import { test } from "node:test";
import assert from "node:assert/strict";
import { remoteHref } from "./git-remote.ts";

test("https remotes link as-is without .git", () => {
  assert.equal(remoteHref("https://github.com/o/r.git"), "https://github.com/o/r");
  assert.equal(remoteHref("https://git.example.org/o/r"), "https://git.example.org/o/r");
});

test("scp and ssh remotes of known forges map to https", () => {
  assert.equal(remoteHref("git@github.com:o/r.git"), "https://github.com/o/r");
  assert.equal(remoteHref("ssh://git@gitlab.com:22/g/sub/r.git"), "https://gitlab.com/g/sub/r");
});

test("unknown ssh hosts, local paths and empty values are not links", () => {
  assert.equal(remoteHref("git@corp.internal:o/r.git"), null);
  assert.equal(remoteHref("/srv/git/r.git"), null);
  assert.equal(remoteHref(null), null);
  assert.equal(remoteHref(""), null);
});
