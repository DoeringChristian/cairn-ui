/**
 * Waveform peaks of decoded audio, as the SDK records them for a logged
 * `cairn.Audio` (`metadata.peaks`): `bins` values in [0, 1], each the
 * largest absolute sample of its stretch over every channel. Pure.
 */
export function audioPeaks(channels: ReadonlyArray<ArrayLike<number>>, bins = 200): number[] {
  const n = channels.reduce((m, c) => Math.max(m, c.length), 0);
  if (n === 0 || bins <= 0) return [];
  const count = Math.min(bins, n);
  const out = new Array<number>(count).fill(0);
  for (let b = 0; b < count; b++) {
    const start = Math.floor((b * n) / count);
    const end = Math.floor(((b + 1) * n) / count);
    let peak = 0;
    for (const ch of channels) {
      for (let i = start; i < end && i < ch.length; i++) {
        const v = Math.abs(ch[i]!);
        if (v > peak) peak = v;
      }
    }
    out[b] = Math.min(1, peak);
  }
  return out;
}

/** "mono", "stereo", or "Nch". */
export function channelLabel(channels: number): string {
  if (channels === 1) return "mono";
  if (channels === 2) return "stereo";
  return `${channels}ch`;
}

/**
 * A WAV file's own sample rate and channel count, from its `fmt ` chunk
 * (decoding resamples to the audio context's rate, so the decoded buffer
 * cannot tell). Null for anything but RIFF/WAVE.
 */
export function wavFormat(bytes: ArrayBuffer): { sampleRate: number; channels: number } | null {
  const v = new DataView(bytes);
  const tag = (at: number) => (at + 4 <= v.byteLength ? String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3)) : "");
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let at = 12;
  while (at + 8 <= v.byteLength) {
    const size = v.getUint32(at + 4, true);
    if (tag(at) === "fmt " && at + 16 <= v.byteLength) {
      return { channels: v.getUint16(at + 10, true), sampleRate: v.getUint32(at + 12, true) };
    }
    at += 8 + size + (size % 2);
  }
  return null;
}
