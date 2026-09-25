import { test } from "node:test";
import assert from "node:assert/strict";
import { detectMac, formatShortcut, isTypingTarget, matchesShortcut, parseShortcut, type KeyLike } from "./shortcuts.ts";

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

test("parseShortcut", () => {
  assert.deepEqual(parseShortcut("mod+shift+z"), { key: "z", mod: true, ctrl: false, shift: true, alt: false });
  assert.deepEqual(parseShortcut("Escape"), { key: "escape", mod: false, ctrl: false, shift: false, alt: false });
  assert.equal(parseShortcut("mod++").key, "+");
  assert.throws(() => parseShortcut("hyper+z"));
});

test("mod is ⌘ on macOS and Ctrl elsewhere", () => {
  assert.ok(matchesShortcut(key("z", { metaKey: true }), "mod+z", true));
  assert.ok(!matchesShortcut(key("z", { ctrlKey: true }), "mod+z", true));
  assert.ok(matchesShortcut(key("z", { ctrlKey: true }), "mod+z", false));
  assert.ok(!matchesShortcut(key("z", { metaKey: true }), "mod+z", false));
});

test("modifiers match exactly: undo does not fire on redo", () => {
  const redo = key("Z", { metaKey: true, shiftKey: true });
  assert.ok(!matchesShortcut(redo, "mod+z", true));
  assert.ok(matchesShortcut(redo, "mod+shift+z", true));
  assert.ok(!matchesShortcut(key("z", { metaKey: true }), "mod+shift+z", true));
  assert.ok(!matchesShortcut(key("z", { metaKey: true, altKey: true }), "mod+z", true));
  assert.ok(!matchesShortcut(key("z"), "mod+z", true));
});

test("shifted punctuation and named keys", () => {
  assert.ok(matchesShortcut(key("/", { metaKey: true }), "mod+/", true));
  assert.ok(matchesShortcut(key("?", { shiftKey: true }), "shift+?", true));
  assert.ok(matchesShortcut(key("ArrowLeft"), "arrowleft", true));
  assert.ok(!matchesShortcut(key("ArrowLeft", { shiftKey: true }), "arrowleft", true));
});

test("formatShortcut", () => {
  assert.equal(formatShortcut("mod+shift+z", true), "⇧⌘Z");
  assert.equal(formatShortcut("mod+shift+z", false), "Ctrl+Shift+Z");
  assert.equal(formatShortcut("mod+/", true), "⌘/");
  assert.equal(formatShortcut("escape", false), "Esc");
  assert.equal(formatShortcut("arrowright", true), "→");
});

test("isTypingTarget", () => {
  assert.ok(isTypingTarget({ tagName: "INPUT", type: "text" }));
  assert.ok(isTypingTarget({ tagName: "input" }));
  assert.ok(isTypingTarget({ tagName: "TEXTAREA" }));
  assert.ok(isTypingTarget({ tagName: "DIV", isContentEditable: true }));
  assert.ok(!isTypingTarget({ tagName: "INPUT", type: "checkbox" }));
  assert.ok(!isTypingTarget({ tagName: "INPUT", type: "range" }));
  assert.ok(!isTypingTarget({ tagName: "BUTTON" }));
  assert.ok(!isTypingTarget(null));
});

test("detectMac", () => {
  assert.ok(detectMac("MacIntel"));
  assert.ok(detectMac("iPhone"));
  assert.ok(!detectMac("Win32"));
  assert.ok(!detectMac(undefined));
});
