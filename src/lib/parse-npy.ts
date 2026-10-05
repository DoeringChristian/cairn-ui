/**
 * Minimal `.npy` (NumPy array) reader for the browser.
 *
 * Supports NPY format v1.0/v2.0/v3.0 headers and the common numeric dtypes
 * produced by `numpy.save` (float16/32/64, (u)int8/16/32/64, bool). Values are
 * always returned as a `Float64Array` for uniform downstream math — int64/
 * uint64 are narrowed through `Number()` (fine for the counts/indices we plot;
 * values beyond 2^53 lose precision, which never happens for histogram counts
 * or the tensors we render). Big-endian arrays fall back to a per-element
 * `DataView` decode.
 *
 * float16 (`<f2`/`>f2`) is decoded by hand: the SDK saves torch tensors with
 * `np.save` and no cast, so a half-precision tensor reaches us as `f2`, and
 * there is no `Float16Array` under this tsconfig's ES2020 lib.
 *
 * Data payload of NPY is always aligned to 64 bytes (the header is padded so
 * `magic + version + headerlen + header` is a multiple of 64), so we can build
 * typed-array views directly over the buffer without copying in the fast path.
 */

export interface NpyArray {
  /** Raw numpy descr string, e.g. `<f8`, `<i8`, `|u1`. */
  dtype: string;
  /** Array shape; `[]` for a 0-d scalar. */
  shape: number[];
  /** True when stored column-major (numpy `fortran_order`). */
  fortranOrder: boolean;
  /** Flattened values in stored order, coerced to Float64. */
  data: Float64Array;
}

const MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]; // \x93NUMPY

/** Every `kind + itemsize` `decodeData` understands, for the error message. */
const SUPPORTED_DTYPES = "f2, f4, f8, i1, i2, i4, i8, u1, u2, u4, u8, b1";

/**
 * IEEE-754 binary16 → a JS number, exactly. `bits` is the raw 16-bit pattern.
 *
 * exponent 0      → signed zero and the SUBNORMALS (mantissa × 2^-24);
 * exponent 31     → ±Infinity (mantissa 0) or NaN;
 * otherwise       → the normal (1.mantissa) × 2^(exponent-15), written as
 *                   (mantissa + 1024) × 2^(exponent-25) to stay integral.
 * Every result is representable in float32, so the caller may hold them in a
 * `Float32Array` without loss.
 */
function halfToFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x03ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 0x1f) return mantissa === 0 ? sign * Infinity : NaN;
  return sign * (mantissa + 0x400) * 2 ** (exponent - 25);
}

export function parseNpy(buffer: ArrayBuffer): NpyArray {
  const { descr, shape, fortranOrder, dataOffset } = parseNpyHeader(buffer);
  const count = shape.reduce((a, b) => a * b, 1);
  const data = decodeData(buffer, dataOffset, descr, count);
  return { dtype: descr, shape, fortranOrder, data };
}

/** An `.npy` header: dtype descr, shape, order and where the data starts. */
function parseNpyHeader(buffer: ArrayBuffer): { descr: string; shape: number[]; fortranOrder: boolean; dataOffset: number } {
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) throw new Error("parseNpy: not a .npy file");
  }
  const view = new DataView(buffer);
  const major = bytes[6]!;
  let headerLen: number;
  let headerStart: number;
  if (major <= 1) {
    headerLen = view.getUint16(8, true);
    headerStart = 10;
  } else {
    headerLen = view.getUint32(8, true);
    headerStart = 12;
  }
  const header = new TextDecoder("latin1").decode(
    new Uint8Array(buffer, headerStart, headerLen),
  );

  const descrMatch = /'descr'\s*:\s*'([^']+)'/.exec(header);
  const shapeMatch = /'shape'\s*:\s*\(([^)]*)\)/.exec(header);
  if (!descrMatch || !shapeMatch) {
    throw new Error("parseNpy: could not parse header");
  }
  const descr = descrMatch[1]!;
  const fortranOrder = /'fortran_order'\s*:\s*True/.test(header);
  const shape = shapeMatch[1]!
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number);
  return { descr, shape, fortranOrder, dataOffset: headerStart + headerLen };
}

function toF64(arr: ArrayLike<number>): Float64Array {
  return arr instanceof Float64Array ? arr : Float64Array.from(arr);
}

function decodeData(
  buffer: ArrayBuffer,
  offset: number,
  descr: string,
  count: number,
): Float64Array {
  const byteOrder = descr[0]!; // '<' '>' '|' '='
  const kind = descr[1]!; // 'f' 'i' 'u' 'b'
  const itemsize = parseInt(descr.slice(2) || "1", 10);
  const littleEndian = byteOrder !== ">";

  if (littleEndian) {
    switch (kind + itemsize) {
      case "f8":
        return toF64(new Float64Array(buffer, offset, count));
      case "f4":
        return toF64(new Float32Array(buffer, offset, count));
      case "f2":
        return toF64(
          Float32Array.from(new Uint16Array(buffer, offset, count), halfToFloat),
        );
      case "i4":
        return toF64(new Int32Array(buffer, offset, count));
      case "i2":
        return toF64(new Int16Array(buffer, offset, count));
      case "i1":
        return toF64(new Int8Array(buffer, offset, count));
      case "u4":
        return toF64(new Uint32Array(buffer, offset, count));
      case "u2":
        return toF64(new Uint16Array(buffer, offset, count));
      case "u1":
      case "b1":
        return toF64(new Uint8Array(buffer, offset, count));
      case "i8":
        return Float64Array.from(
          new BigInt64Array(buffer, offset, count),
          (v) => Number(v),
        );
      case "u8":
        return Float64Array.from(
          new BigUint64Array(buffer, offset, count),
          (v) => Number(v),
        );
    }
  }

  // Slow path: big-endian or an unusual itemsize — decode element by element.
  const view = new DataView(buffer, offset);
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const p = i * itemsize;
    if (kind === "f" && itemsize === 8) out[i] = view.getFloat64(p, littleEndian);
    else if (kind === "f" && itemsize === 4) out[i] = view.getFloat32(p, littleEndian);
    else if (kind === "f" && itemsize === 2)
      out[i] = halfToFloat(view.getUint16(p, littleEndian));
    else if (kind === "i" && itemsize === 4) out[i] = view.getInt32(p, littleEndian);
    else if (kind === "i" && itemsize === 2) out[i] = view.getInt16(p, littleEndian);
    else if (kind === "i" && itemsize === 1) out[i] = view.getInt8(p);
    else if (kind === "u" && itemsize === 4) out[i] = view.getUint32(p, littleEndian);
    else if (kind === "u" && itemsize === 2) out[i] = view.getUint16(p, littleEndian);
    else if ((kind === "u" || kind === "b") && itemsize === 1) out[i] = view.getUint8(p);
    else if (kind === "i" && itemsize === 8)
      out[i] = Number(view.getBigInt64(p, littleEndian));
    else if (kind === "u" && itemsize === 8)
      out[i] = Number(view.getBigUint64(p, littleEndian));
    else {
      throw new Error(
        `parseNpy: unsupported dtype '${descr}' (supported: ${SUPPORTED_DTYPES})`,
      );
    }
  }
  return out;
}

/** The array types {@link parseNpyTyped} returns. */
export type NativeArray =
  | Float32Array | Float64Array
  | Int8Array | Int16Array | Int32Array
  | Uint8Array | Uint16Array | Uint32Array;

/** An `.npy` array in its own dtype (custom viewers get these). */
export interface TypedNpyArray {
  /** The array's values in stored order, in a standalone (transferable) buffer. */
  data: NativeArray;
  shape: number[];
  /** Numpy dtype name: `float32`, `int64`, `bool`, … (the stored dtype, also when `data` widens it). */
  dtype: string;
  /** `"F"` when stored column-major (numpy `fortran_order`), else `"C"`. */
  order: "C" | "F";
}

const DTYPE_NAMES: Record<string, string> = {
  f2: "float16", f4: "float32", f8: "float64",
  i1: "int8", i2: "int16", i4: "int32", i8: "int64",
  u1: "uint8", u2: "uint16", u4: "uint32", u8: "uint64",
  b1: "bool",
};

/**
 * `.npy` → its values in the matching native typed array (a copy in a
 * standalone buffer, so it can be transferred). Widened where JS has no such
 * array: float16 → Float32Array; int64/uint64 → Float64Array (exact up to
 * 2^53). Big-endian input is converted to the platform's order.
 */
export function parseNpyTyped(buffer: ArrayBuffer): TypedNpyArray {
  const head = parseNpyHeader(buffer);
  const { descr, shape, fortranOrder, dataOffset } = head;
  const count = shape.reduce((a, b) => a * b, 1);
  const kind = descr[1]!;
  const itemsize = parseInt(descr.slice(2) || "1", 10);
  const code = kind + itemsize;
  const dtype = DTYPE_NAMES[code];
  if (!dtype) throw new Error(`parseNpy: unsupported dtype '${descr}' (supported: ${SUPPORTED_DTYPES})`);
  const little = descr[0] !== ">";
  const order = fortranOrder ? "F" : "C";
  const view = new DataView(buffer, dataOffset, count * itemsize);
  const read = <T extends NativeArray>(make: (n: number) => T, get: (i: number) => number): T => {
    const out = make(count);
    for (let i = 0; i < count; i++) out[i] = get(i);
    return out;
  };
  // Little-endian, natively sized: one copy of the bytes.
  const copy = <T extends NativeArray>(ctor: { new (b: ArrayBuffer): T }): T =>
    new ctor(buffer.slice(dataOffset, dataOffset + count * itemsize));
  let data: NativeArray;
  switch (code) {
    case "f4": data = little ? copy(Float32Array) : read((n) => new Float32Array(n), (i) => view.getFloat32(i * 4, false)); break;
    case "f8": data = little ? copy(Float64Array) : read((n) => new Float64Array(n), (i) => view.getFloat64(i * 8, false)); break;
    case "f2": data = read((n) => new Float32Array(n), (i) => halfToFloat(view.getUint16(i * 2, little))); break;
    case "i1": data = copy(Int8Array); break;
    case "u1": case "b1": data = copy(Uint8Array); break;
    case "i2": data = little ? copy(Int16Array) : read((n) => new Int16Array(n), (i) => view.getInt16(i * 2, false)); break;
    case "u2": data = little ? copy(Uint16Array) : read((n) => new Uint16Array(n), (i) => view.getUint16(i * 2, false)); break;
    case "i4": data = little ? copy(Int32Array) : read((n) => new Int32Array(n), (i) => view.getInt32(i * 4, false)); break;
    case "u4": data = little ? copy(Uint32Array) : read((n) => new Uint32Array(n), (i) => view.getUint32(i * 4, false)); break;
    case "i8": data = read((n) => new Float64Array(n), (i) => Number(view.getBigInt64(i * 8, little))); break;
    default: data = read((n) => new Float64Array(n), (i) => Number(view.getBigUint64(i * 8, little))); break;
  }
  return { data, shape, dtype, order };
}
