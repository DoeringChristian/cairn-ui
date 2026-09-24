/**
 * A point's caption: `metadata` is the point's raw JSON metadata string
 * (`SequencePoint.metadata`); a gallery entry carries its own `caption`.
 */
export function pointCaption(metadata: string | null | undefined): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (parsed && typeof parsed === "object" && "caption" in parsed) {
      const caption = (parsed as { caption: unknown }).caption;
      return typeof caption === "string" && caption !== "" ? caption : null;
    }
  } catch {
    // Unparseable metadata has no caption.
  }
  return null;
}
