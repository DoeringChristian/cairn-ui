/**
 * Fields shared by every card's persisted settings interface.
 *
 * Each card type (Scalar, Image, Figure, ...) declares its own settings
 * interface extending this one, adding card-specific fields. See
 * `src/lib/card-settings.ts` for the persistence machinery (useCardSettings,
 * resolveCardHeight) — that module keeps its own structural types to avoid
 * an import cycle (card-kit imports from lib, not vice versa).
 */
export interface BaseCardSettings {
  version: 1;
  title?: string;
  collapsed?: boolean;
  /** Persisted card height in px; undefined = the card's default. */
  height?: number;
  colSpan?: number;
}
