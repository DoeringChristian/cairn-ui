/** Heatmap colormaps. Plotly.js lacks turbo/magma/plasma, so those carry their stops. */
export type Colormap = "turbo" | "magma" | "plasma" | "viridis" | "greys";

export type Colorscale = string | Array<[number, string]>;

function stops(rgb: Array<[number, number, number]>): Array<[number, string]> {
  return rgb.map(([r, g, b], i) => [i / (rgb.length - 1), `rgb(${r},${g},${b})`]);
}

const COLORSCALES: Record<Colormap, Colorscale> = {
  turbo: stops([
    [48, 18, 59], [69, 92, 207], [62, 155, 254], [24, 215, 202], [70, 248, 132], [164, 252, 60],
    [225, 221, 55], [254, 164, 49], [240, 91, 18], [195, 37, 3], [122, 4, 3],
  ]),
  magma: stops([
    [0, 0, 4], [21, 14, 56], [59, 15, 112], [101, 26, 128], [140, 41, 129], [183, 55, 121],
    [222, 73, 104], [247, 112, 92], [254, 159, 109], [254, 207, 146], [252, 253, 191],
  ]),
  plasma: stops([[13, 8, 135], [126, 3, 168], [204, 71, 120], [248, 149, 64], [240, 249, 33]]),
  viridis: "Viridis",
  greys: "Greys",
};

export const COLORMAP_OPTIONS: Array<{ value: Colormap; label: string }> = [
  { value: "turbo", label: "Turbo" },
  { value: "magma", label: "Magma" },
  { value: "plasma", label: "Plasma" },
  { value: "viridis", label: "Viridis" },
  { value: "greys", label: "Greys" },
];

export function colorscale(name: Colormap): Colorscale {
  return COLORSCALES[name] ?? COLORSCALES.turbo;
}

/** RGB stops of the scales `colorscale()` names instead of listing (Plotly's). */
const NAMED_RGB: Record<string, Array<[number, number, number]>> = {
  Viridis: [
    [68, 1, 84], [72, 40, 120], [62, 73, 137], [49, 104, 142], [38, 130, 142],
    [31, 158, 137], [53, 183, 121], [110, 206, 88], [181, 222, 43], [253, 231, 37],
  ],
  Greys: [[0, 0, 0], [255, 255, 255]],
};

function parseRgb(c: string): [number, number, number] {
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(c);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

/** The colour at `t` ∈ [0, 1] along a colormap (linear between stops), as `#rrggbb`. */
export function sampleColormap(name: Colormap, t: number): string {
  const scale = colorscale(name);
  const pts: Array<[number, [number, number, number]]> =
    typeof scale === "string"
      ? (NAMED_RGB[scale] ?? NAMED_RGB.Greys!).map((rgb, i, a) => [i / (a.length - 1), rgb])
      : scale.map(([at, c]) => [at, parseRgb(c)]);
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  let i = 1;
  while (i < pts.length - 1 && pts[i]![0] < x) i++;
  const [t0, a] = pts[i - 1]!;
  const [t1, b] = pts[i]!;
  const f = t1 > t0 ? (x - t0) / (t1 - t0) : 0;
  const hex = (k: number) => Math.round(a[k]! + (b[k]! - a[k]!) * f).toString(16).padStart(2, "0");
  return `#${hex(0)}${hex(1)}${hex(2)}`;
}
