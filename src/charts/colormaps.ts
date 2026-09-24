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
