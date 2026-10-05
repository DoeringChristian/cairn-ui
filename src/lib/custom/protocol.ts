/**
 * Custom viewers: the postMessage protocol between the card (host) and a
 * viewer's sandboxed frame (pure; tested in protocol.test.ts). The frame
 * side is the `cairn:sdk` runtime (sdk-runtime.ts), which speaks the same
 * messages.
 *
 * Every message is `{type: "cairn:<name>", v: PROTOCOL_VERSION, …}`.
 * Receivers ignore unknown fields and unknown types, and accept any `v`
 * (a newer peer only adds fields).
 *
 * host → frame
 * - `cairn:boot`     {files, imports, entry}       load the viewer (once)
 * - `cairn:render`   {seq, inputs, step, settings, size, theme, view}
 * - `cairn:view`     {view}                         a sibling pane moved the shared view
 * - `cairn:resize`   {size}
 * - `cairn:theme`    {theme}
 * - `cairn:settings` {settings}                     only the settings changed (inputs as before)
 * - `cairn:snapshot` {id}                           please send a snapshot
 *
 * frame → host
 * - `cairn:ready`    {sdk}                           the boot script runs; send `cairn:boot`
 * - `cairn:loaded`   {}                              the viewer's entry module ran
 * - `cairn:rendered` {seq}                           a render call returned
 * - `cairn:view`     {view, final}                   the user moved the view (`final`: gesture end)
 * - `cairn:size`     {height}                        the content's preferred height
 * - `cairn:settings` {patch}                         the viewer changes its own settings (validated by the host)
 * - `cairn:snapshot` {id, url}                       a data/blob URL of the current picture, or null
 * - `cairn:error`    {message, stack?}
 */

export const PROTOCOL_VERSION = 1;

/** Theme tokens a viewer can style itself with (CSS colors). */
export interface ViewerTheme {
  mode: "light" | "dark";
  bg: string;
  fg: string;
  muted: string;
  border: string;
  accent: string;
  font: string;
  monoFont: string;
}

export interface ViewerSize {
  width: number;
  height: number;
  dpr: number;
}

/** One input of a render: a logged value and where it comes from. */
export interface ViewerInput {
  /** npz: `{name: {data, shape, dtype, order}}`; json: the value; bytes: an ArrayBuffer. */
  data: unknown;
  /** `npz` | `json` | `bytes` (custom data), or the built-in object type's own format. */
  format: string;
  /** The custom data's kind (`guiding/vmf`), or the built-in object type. */
  kind: string;
  /** The `meta` logged with the value. */
  meta: Record<string, unknown>;
  step: number;
  run: string;
  /** Series name. */
  name: string;
  /** What the card calls this input (series or run label; `reference` for B). */
  label: string;
  caption?: string;
}

export type HostMessage =
  | { type: "cairn:boot"; v: number; files: Array<{ path: string; mime: string; data: string | ArrayBuffer }>; imports: Record<string, string>; entry: string }
  | {
      type: "cairn:render";
      v: number;
      seq: number;
      inputs: ViewerInput[];
      step: number;
      settings: Record<string, unknown>;
      size: ViewerSize;
      theme: ViewerTheme;
      view: unknown;
    }
  | { type: "cairn:view"; v: number; view: unknown }
  | { type: "cairn:resize"; v: number; size: ViewerSize }
  | { type: "cairn:theme"; v: number; theme: ViewerTheme }
  | { type: "cairn:settings"; v: number; settings: Record<string, unknown> }
  | { type: "cairn:snapshot"; v: number; id: number };

export type FrameMessage =
  | { type: "cairn:ready"; sdk: string }
  | { type: "cairn:loaded" }
  | { type: "cairn:rendered"; seq: number }
  | { type: "cairn:view"; view: unknown; final: boolean }
  | { type: "cairn:size"; height: number }
  | { type: "cairn:settings"; patch: Record<string, string | number | boolean> }
  | { type: "cairn:snapshot"; id: number; url: string | null }
  | { type: "cairn:error"; message: string; stack?: string };

type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A host message with the protocol version stamped on. */
export function hostMessage(msg: Without<HostMessage, "v">): HostMessage {
  return { ...msg, v: PROTOCOL_VERSION } as HostMessage;
}

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 4000): string | null => (typeof v === "string" ? v.slice(0, max) : null);
const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Validate a message from a frame: the known fields of a known type, copied
 * (unknown fields dropped); null for anything else. The frame is untrusted:
 * nothing it sends is used without passing through here.
 */
export function decodeFrameMessage(raw: unknown): FrameMessage | null {
  if (!isObj(raw) || typeof raw.type !== "string") return null;
  switch (raw.type) {
    case "cairn:ready":
      return { type: "cairn:ready", sdk: str(raw.sdk, 40) ?? "" };
    case "cairn:loaded":
      return { type: "cairn:loaded" };
    case "cairn:rendered": {
      const seq = finite(raw.seq);
      return seq == null ? null : { type: "cairn:rendered", seq };
    }
    case "cairn:view": {
      if (!("view" in raw)) return null;
      // Views are opaque JSON; one that does not survive JSON is refused (no functions, cycles, buffers).
      let view: unknown;
      try {
        const json = JSON.stringify(raw.view);
        if (json === undefined || json.length > 64_000) return null;
        view = JSON.parse(json);
      } catch {
        return null;
      }
      return { type: "cairn:view", view, final: raw.final === true };
    }
    case "cairn:size": {
      const h = finite(raw.height);
      return h == null || h < 0 ? null : { type: "cairn:size", height: h };
    }
    case "cairn:settings": {
      // Primitive values only; the host checks them against the manifest (validateSettingsPatch).
      if (!isObj(raw.patch)) return null;
      const patch: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries(raw.patch).slice(0, 100)) {
        if (typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) patch[k.slice(0, 100)] = v;
      }
      return { type: "cairn:settings", patch };
    }
    case "cairn:snapshot": {
      const id = finite(raw.id);
      if (id == null) return null;
      const url = str(raw.url, 32_000_000);
      // Only pictures: a data:image URL or a blob made in the frame is useless outside it, so data: only.
      return { type: "cairn:snapshot", id, url: url && /^data:image\/(png|jpeg|webp);base64,/.test(url) ? url : null };
    }
    case "cairn:error": {
      const message = str(raw.message) ?? "viewer error";
      const stack = str(raw.stack);
      return stack ? { type: "cairn:error", message, stack } : { type: "cairn:error", message };
    }
    default:
      return null;
  }
}

/** The buffers in a value (typed arrays' and plain ArrayBuffers), each once: the transfer list of a render. */
export function transferables(value: unknown, out: Set<ArrayBuffer> = new Set(), depth = 0): ArrayBuffer[] {
  if (depth > 8 || value == null || typeof value !== "object") return [...out];
  if (value instanceof ArrayBuffer) out.add(value);
  else if (ArrayBuffer.isView(value)) {
    if (value.buffer instanceof ArrayBuffer) out.add(value.buffer);
  } else if (Array.isArray(value)) for (const v of value) transferables(v, out, depth + 1);
  else for (const v of Object.values(value)) transferables(v, out, depth + 1);
  return [...out];
}
