/**
 * A store-only (uncompressed) zip writer: local file headers, the central
 * directory and the end record, with CRC-32 checksums. Enough for exports
 * (PNG/JPEG are compressed already), with no dependency. File names are
 * UTF-8 (general-purpose flag bit 11). No zip64: every size and offset must
 * stay under 4 GiB, and there can be at most 65535 entries.
 */

export interface ZipEntry {
  /** Path inside the archive, `/`-separated, no leading slash. */
  name: string;
  data: Uint8Array;
}

let CRC_TABLE: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (CRC_TABLE = t);
}

/** CRC-32 (IEEE 802.3, the one zip and gzip use). */
export function crc32(data: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS time and date words (local time, 2-second resolution, years from 1980). */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Build a zip archive holding `entries` uncompressed. */
export function zipStore(entries: ZipEntry[], modified: Date = new Date()): Uint8Array {
  if (entries.length > 0xffff) throw new Error("zip: too many entries");
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(modified);
  const names = entries.map((e) => enc.encode(e.name));
  const crcs = entries.map((e) => crc32(e.data));

  const localSize = entries.reduce((n, e, i) => n + 30 + names[i]!.length + e.data.length, 0);
  const centralSize = names.reduce((n, name) => n + 46 + name.length, 0);
  const total = localSize + centralSize + 22;
  if (total > 0xffffffff) throw new Error("zip: archive too large");

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  let p = 0;
  const u16 = (v: number) => {
    view.setUint16(p, v, true);
    p += 2;
  };
  const u32 = (v: number) => {
    view.setUint32(p, v >>> 0, true);
    p += 4;
  };
  const bytes = (b: Uint8Array) => {
    out.set(b, p);
    p += b.length;
  };

  entries.forEach((e, i) => {
    offsets.push(p);
    u32(0x04034b50); // local file header
    u16(20); // version needed: 2.0
    u16(0x0800); // flags: UTF-8 names
    u16(0); // method: store
    u16(time);
    u16(date);
    u32(crcs[i]!);
    u32(e.data.length); // compressed size
    u32(e.data.length); // uncompressed size
    u16(names[i]!.length);
    u16(0); // extra length
    bytes(names[i]!);
    bytes(e.data);
  });

  const centralStart = p;
  entries.forEach((e, i) => {
    u32(0x02014b50); // central directory header
    u16(20); // version made by
    u16(20); // version needed
    u16(0x0800);
    u16(0);
    u16(time);
    u16(date);
    u32(crcs[i]!);
    u32(e.data.length);
    u32(e.data.length);
    u16(names[i]!.length);
    u16(0); // extra length
    u16(0); // comment length
    u16(0); // disk number start
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(offsets[i]!);
    bytes(names[i]!);
  });

  u32(0x06054b50); // end of central directory
  u16(0); // this disk
  u16(0); // disk with the central directory
  u16(entries.length);
  u16(entries.length);
  u32(centralSize); // central directory size
  u32(centralStart);
  u16(0); // comment length
  return out;
}
