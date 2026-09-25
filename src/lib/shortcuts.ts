/**
 * Keyboard shortcuts (pure): parsing, matching and display.
 *
 * A shortcut is written like `"mod+shift+z"`: `+`-separated modifiers
 * (`mod` = ⌘ on macOS and Ctrl elsewhere, `ctrl`, `shift`, `alt`) and a key
 * (`KeyboardEvent.key`, case-insensitive; `"/"`, `"escape"`, `"arrowleft"`, …).
 * The hook that binds them is `lib/use-shortcut.ts`.
 */

export interface Shortcut {
  /** Lower-cased `KeyboardEvent.key`. */
  key: string;
  mod: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

/** The fields of a `KeyboardEvent` a match reads. */
export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function parseShortcut(spec: string): Shortcut {
  const parts = spec.toLowerCase().split("+");
  // "mod++" binds the plus key itself.
  const key = spec.endsWith("++") ? "+" : parts[parts.length - 1]!;
  const mods = new Set(parts.slice(0, spec.endsWith("++") ? -2 : -1));
  for (const m of mods) {
    if (m !== "mod" && m !== "ctrl" && m !== "shift" && m !== "alt") {
      throw new Error(`unknown modifier "${m}" in shortcut "${spec}"`);
    }
  }
  if (!key) throw new Error(`shortcut "${spec}" has no key`);
  return { key, mod: mods.has("mod"), ctrl: mods.has("ctrl"), shift: mods.has("shift"), alt: mods.has("alt") };
}

/**
 * Whether `e` triggers `shortcut`. Every modifier must match exactly, so
 * `mod+z` does not fire on ⌘⇧Z. With Shift held, letters arrive upper-cased
 * and are compared case-insensitively.
 */
export function matchesShortcut(e: KeyLike, shortcut: Shortcut | string, isMac: boolean): boolean {
  const s = typeof shortcut === "string" ? parseShortcut(shortcut) : shortcut;
  const wantMeta = s.mod && isMac;
  const wantCtrl = s.ctrl || (s.mod && !isMac);
  if (e.metaKey !== wantMeta || e.ctrlKey !== wantCtrl) return false;
  if (e.altKey !== s.alt) return false;
  // Shifted punctuation ("?" for shift+/) arrives as the shifted character;
  // only letters and named keys are held to an exact Shift match.
  const key = e.key.toLowerCase();
  const isLetterOrNamed = /^[a-z]$/.test(key) || key.length > 1;
  if (isLetterOrNamed && e.shiftKey !== s.shift) return false;
  if (!isLetterOrNamed && s.shift && !e.shiftKey) return false;
  return key === s.key;
}

const MAC_SYMBOLS = { mod: "⌘", ctrl: "⌃", shift: "⇧", alt: "⌥" } as const;
const KEY_NAMES: Record<string, string> = {
  escape: "Esc",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  enter: "↵",
  " ": "Space",
};

/** Display form: "⌘⇧Z" on macOS, "Ctrl+Shift+Z" elsewhere. */
export function formatShortcut(shortcut: Shortcut | string, isMac: boolean): string {
  const s = typeof shortcut === "string" ? parseShortcut(shortcut) : shortcut;
  const key = KEY_NAMES[s.key] ?? (s.key.length === 1 ? s.key.toUpperCase() : s.key[0]!.toUpperCase() + s.key.slice(1));
  if (isMac) {
    return (
      (s.ctrl ? MAC_SYMBOLS.ctrl : "") +
      (s.alt ? MAC_SYMBOLS.alt : "") +
      (s.shift ? MAC_SYMBOLS.shift : "") +
      (s.mod ? MAC_SYMBOLS.mod : "") +
      key
    );
  }
  const mods = [s.mod || s.ctrl ? "Ctrl" : null, s.alt ? "Alt" : null, s.shift ? "Shift" : null].filter(Boolean);
  return [...mods, key].join("+");
}

/** The fields of an event target `isTypingTarget` reads. */
export interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  type?: string;
}

const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "range", "button", "submit", "reset", "color", "file"]);

/**
 * Whether keys typed at `t` belong to a text field — shortcuts then leave the
 * key alone (⌘Z in a text box undoes typing, not a setting).
 */
export function isTypingTarget(t: TargetLike | null | undefined): boolean {
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName?.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has((t.type ?? "text").toLowerCase());
  return false;
}

/** Whether the platform uses ⌘ as its primary modifier. */
export function detectMac(platform: string | undefined): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform ?? "");
}
