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
