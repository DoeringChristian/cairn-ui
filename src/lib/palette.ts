/**
 * Ten distinct category colours (0xRRGGBB), shared by everything coloured by
 * a class/category id: 3D point categories and image overlay classes.
 * Deliberately longer than the six-colour series palette: segmentations
 * routinely carry more classes than a card carries runs.
 */
export const CATEGORY_RGB: readonly number[] = [
  0x1f77b4, 0xff7f0e, 0x2ca02c, 0xd62728, 0x9467bd,
  0x8c564b, 0xe377c2, 0x7f7f7f, 0xbcbd22, 0x17becf,
];

/** The palette colour (0xRRGGBB) for a category id, cycling the palette. */
export function categoryRgb(id: number): number {
  return CATEGORY_RGB[Math.max(0, Math.round(id)) % CATEGORY_RGB.length]!;
}
