/**
 * The card settings cascade (pure).
 *
 * A card's effective settings resolve per top-level key through layers,
 * highest first:
 *
 *   card overrides → instance defaults → section → workspace → builtin
 *
 * Only a card type's `cascadeKeys` read the section and workspace layers;
 * every other key (metrics, title, height, colSpan, viewport, collapsed, …)
 * resolves card → instance → builtin. Instance defaults are what a card was
 * created with (its seed metric, a sweep's axes, a metric's tracked x-axis),
 * so they sit above the shared defaults. The card layer stores overrides
 * only: a value equal to what the card would inherit is dropped on write.
 */

export type SettingsRecord = Record<string, unknown>;

export interface SettingsLayers<T extends object = SettingsRecord> {
  /** The card type's built-in defaults: every key the type knows. */
  builtin: T;
  /** Workspace-wide defaults for this card type (cascade keys only). */
  workspace?: Partial<T>;
  /** The section's defaults for this card type (cascade keys only). */
  section?: Partial<T>;
  /** What this card instance was created with. */
  instance?: Partial<T>;
  /** The card's own overrides. */
  card?: Partial<T>;
}

const has = (o: object | undefined, key: string): boolean =>
  o != null && Object.prototype.hasOwnProperty.call(o, key) && (o as SettingsRecord)[key] !== undefined;

/** The layers a key reads, highest first, excluding the card layer. */
function parentLayers<T extends object>(
  layers: SettingsLayers<T>,
  key: string,
  cascadeKeys: ReadonlySet<string> | readonly string[],
): Array<Partial<T> | undefined> {
  const cascades = Array.isArray(cascadeKeys)
    ? (cascadeKeys as readonly string[]).includes(key)
    : (cascadeKeys as ReadonlySet<string>).has(key);
  return cascades
    ? [layers.instance, layers.section, layers.workspace, layers.builtin]
    : [layers.instance, layers.builtin];
}

/** The value `key` resolves to without the card's own override. */
export function parentValue<T extends object>(
  layers: SettingsLayers<T>,
  key: string,
  cascadeKeys: ReadonlySet<string> | readonly string[],
): unknown {
  for (const layer of parentLayers(layers, key, cascadeKeys)) {
    if (has(layer, key)) return (layer as SettingsRecord)[key];
  }
  return undefined;
}

/** Resolve every key of every layer into the card's effective settings. */
export function resolveSettings<T extends object>(
  layers: SettingsLayers<T>,
  cascadeKeys: ReadonlySet<string> | readonly string[],
): T {
  const keys = new Set<string>();
  for (const layer of [layers.builtin, layers.workspace, layers.section, layers.instance, layers.card]) {
    if (layer) for (const k of Object.keys(layer)) keys.add(k);
  }
  const out: SettingsRecord = {};
  for (const key of keys) {
    const v = has(layers.card, key)
      ? (layers.card as SettingsRecord)[key]
      : parentValue(layers, key, cascadeKeys);
    if (v !== undefined) out[key] = v;
  }
  return out as T;
}

/** Whether the card layer overrides `key`. */
export function isOverridden(card: object | undefined | null, key: string): boolean {
  return has(card ?? undefined, key);
}

/** Structural equality of JSON-like values. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => jsonEqual(v, bb[i]));
  }
  const ao = a as SettingsRecord;
  const bo = b as SettingsRecord;
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined);
  return ak.length === bk.length && ak.every((k) => jsonEqual(ao[k], bo[k]));
}

/**
 * Apply `patch` to the card overrides. A value equal to its parent (what the
 * card would inherit), or `undefined`, removes the override instead. Returns a
 * new object; `card` is never mutated.
 */
export function setOverride<T extends object>(
  card: Partial<T> | undefined | null,
  patch: Partial<T>,
  parent: (key: string) => unknown,
): Partial<T> {
  const next: SettingsRecord = { ...(card ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || jsonEqual(value, parent(key))) delete next[key];
    else next[key] = value;
  }
  return next as Partial<T>;
}

/** Drop the card's override of `key`. Returns a new object. */
export function removeOverride<T extends object>(card: Partial<T> | undefined | null, key: string): Partial<T> {
  const next: SettingsRecord = { ...(card ?? {}) };
  delete next[key];
  return next as Partial<T>;
}
