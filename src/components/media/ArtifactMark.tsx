/**
 * Marks the artifact a card shows (a pane, a gallery item) for the card
 * header's download (lib/download.ts `downloadCardArtifacts`): one marked
 * artifact downloads as itself, several as a zip. `display: contents`, so it
 * changes no layout.
 */

import type { ReactNode } from "react";
import { artifactFilename } from "../../lib/download";

export default function ArtifactMark({
  hash,
  name,
  step,
  mime,
  ext,
  children,
}: {
  hash: string | null | undefined;
  /** The series name (the file is `<name>_step<N>.<ext>`); omitted: the card's title. */
  name?: string;
  step?: number;
  mime?: string | null;
  /** The file extension when the mime type does not tell it (`.npz`, `.npy`). */
  ext?: string;
  children: ReactNode;
}) {
  if (!hash) return <>{children}</>;
  return (
    <div
      style={{ display: "contents" }}
      data-cairn-artifact={hash}
      data-cairn-artifact-name={name != null ? artifactFilename(name, step ?? 0, mime, ext) : undefined}
    >
      {children}
    </div>
  );
}
