import assert from "node:assert/strict";
import test from "node:test";
import { createFragmentLogin } from "./fragment-login.ts";

function browser(hash: string) {
  const location = { hash, pathname: "/login", search: "?return=%2Fp%2Fstudy" };
  const replacements: unknown[][] = [];
  const history = {
    state: { key: "router-history" },
    replaceState(...args: unknown[]) { replacements.push(args); location.hash = ""; },
  };
  return { location, history, replacements };
}

test("removes the token before login and preserves router state without storing credentials", async () => {
  const page = browser("#token=a%2Bb%26c%2Fd%23e");
  const login = createFragmentLogin();
  const tokens: string[] = [];
  const pending = login(page.location, page.history, async token => {
    assert.equal(page.location.hash, "");
    tokens.push(token);
  });
  assert.equal(page.location.hash, "");
  assert.deepEqual(page.replacements, [[page.history.state, "", "/login?return=%2Fp%2Fstudy"]]);
  await pending;
  assert.deepEqual(tokens, ["a+b&c/d#e"]);
});

test("StrictMode cleanup and setup share one request and the second subscriber sees completion", async () => {
  const page = browser("#token=shared");
  const login = createFragmentLogin();
  let requests = 0;
  let finish!: () => void;
  const exchange = () => { requests++; return new Promise<void>(resolve => { finish = resolve; }); };
  let firstActive = true;
  let firstCompleted = false;
  let secondCompleted = false;
  const first = login(page.location, page.history, exchange)!;
  void first.then(() => { if (firstActive) firstCompleted = true; });
  firstActive = false;
  const second = login(page.location, page.history, exchange)!;
  assert.equal(first, second);
  void second.then(() => { secondCompleted = true; });
  await Promise.resolve();
  assert.equal(requests, 1);
  finish();
  await second;
  assert.equal(firstCompleted, false);
  assert.equal(secondCompleted, true);
  assert.equal(page.replacements.length, 1);
});

test("a rejected login remains visible to the remounted subscriber without retrying", async () => {
  const page = browser("#token=invalid");
  const login = createFragmentLogin();
  let requests = 0;
  const exchange = async () => { requests++; throw new Error("unauthorized"); };
  await assert.rejects(login(page.location, page.history, exchange)!, /unauthorized/);
  await assert.rejects(login(page.location, page.history, exchange)!, /unauthorized/);
  assert.equal(page.location.hash, "");
  assert.equal(requests, 1);
});

test("normal login pages preserve their hash and do not authenticate automatically", () => {
  const page = browser("#help");
  const pending = createFragmentLogin()(page.location, page.history, async () => assert.fail("no token"));
  assert.equal(pending, null);
  assert.equal(page.location.hash, "#help");
  assert.equal(page.replacements.length, 0);
});

for (const hash of ["#token=", "#token=secret%20value", "#token=one&token=two", "#token="+"x".repeat(4097)]) {
  test("malformed login fragment is removed and rejected without exposing it: "+hash.slice(0, 22), async () => {
    const page = browser(hash);
    const pending = createFragmentLogin()(page.location, page.history, async () => assert.fail("invalid token"));
    await assert.rejects(pending!, error => error instanceof Error && error.message === "The login link does not contain a valid server token.");
    assert.equal(page.location.hash, "");
  });
}
