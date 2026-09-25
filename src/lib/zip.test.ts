import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";
import { crc32, zipStore } from "./zip.ts";

const enc = new TextEncoder();

test("crc32 matches known vectors", () => {
  assert.equal(crc32(new Uint8Array()), 0);
  assert.equal(crc32(enc.encode("123456789")), 0xcbf43926);
  assert.equal(crc32(enc.encode("The quick brown fox jumps over the lazy dog")), 0x414fa339);
});

test("crc32 agrees with node's zlib.crc32 on random data", () => {
  const nodeCrc = (zlib as unknown as { crc32?: (d: Uint8Array) => number }).crc32;
  if (!nodeCrc) return;
  for (const len of [1, 7, 255, 4096, 100_003]) {
    const data = new Uint8Array(len);
    for (let i = 0; i < len; i++) data[i] = (i * 2654435761) >>> 24;
    assert.equal(crc32(data), nodeCrc(data));
  }
});

function u32(b: Uint8Array, at: number): number {
  return new DataView(b.buffer, b.byteOffset).getUint32(at, true);
}
function u16(b: Uint8Array, at: number): number {
  return new DataView(b.buffer, b.byteOffset).getUint16(at, true);
}

test("zipStore lays out local headers, central directory and end record", () => {
  const a = enc.encode("hello");
  const zip = zipStore([{ name: "a.txt", data: a }], new Date(2024, 0, 2, 3, 4, 6));
  assert.equal(zip.length, 30 + 5 + 5 + 46 + 5 + 22);
  assert.equal(u32(zip, 0), 0x04034b50);
  assert.equal(u16(zip, 8), 0); // stored
  assert.equal(u32(zip, 14), crc32(a));
  assert.equal(u32(zip, 18), 5);
  assert.equal(new TextDecoder().decode(zip.subarray(30, 35)), "a.txt");
  assert.equal(new TextDecoder().decode(zip.subarray(35, 40)), "hello");
  const cd = 40;
  assert.equal(u32(zip, cd), 0x02014b50);
  assert.equal(u32(zip, cd + 42), 0); // local header offset
  const eocd = zip.length - 22;
  assert.equal(u32(zip, eocd), 0x06054b50);
  assert.equal(u16(zip, eocd + 10), 1);
  assert.equal(u32(zip, eocd + 12), 46 + 5);
  assert.equal(u32(zip, eocd + 16), cd);
  // 2024-01-02 03:04:06 in DOS format.
  assert.equal(u16(zip, 10), (3 << 11) | (4 << 5) | 3);
  assert.equal(u16(zip, 12), (44 << 9) | (1 << 5) | 2);
});

test("unzip -t accepts the archive and extracts identical bytes", (t) => {
  if (spawnSync("unzip", ["-v"]).status !== 0) {
    t.skip("unzip not installed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "cairn-zip-"));
  try {
    const png = new Uint8Array(3000);
    for (let i = 0; i < png.length; i++) png[i] = (i * 31) & 0xff;
    const files = [
      { name: "report.tex", data: enc.encode("\\documentclass{article}\n") },
      { name: "figures/card-1.png", data: png },
      { name: "assets/abc.txt", data: enc.encode("ünïcode") },
      { name: "empty.txt", data: new Uint8Array() },
    ];
    const path = join(dir, "out.zip");
    writeFileSync(path, zipStore(files));
    const out = execFileSync("unzip", ["-t", path], { encoding: "utf8" });
    assert.match(out, /No errors detected/);
    execFileSync("unzip", ["-q", path, "-d", join(dir, "x")]);
    for (const f of files) assert.deepEqual(new Uint8Array(readFileSync(join(dir, "x", f.name))), f.data);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
