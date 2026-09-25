/**
 * Image paste/drop into a markdown cell. Each image is uploaded to the
 * report's asset store; while it uploads, a placeholder
 * `![Uploading <name>…]()` sits where it will go, and when it lands the
 * placeholder becomes `![](cairn-asset:<hash>)` (rendered through
 * `AssetUrlContext`, see lib/markdown.tsx). A failed upload removes its
 * placeholder and keeps an inline error until dismissed.
 *
 * `replaceText(placeholder, next)` swaps the placeholder in whichever copy of
 * the text holds it now (the open editor's draft, or the saved cell).
 */

import { useCallback, useRef, useState } from "react";
import { api } from "../../api/client";

export interface UploadStatus {
  id: number;
  name: string;
  /** 0..1 */
  progress: number;
  error?: string;
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** The image files in a paste or drop (other files and text are ignored). */
export function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files).filter((f) => IMAGE_TYPES.has(f.type));
}

let nextId = 1;

export function useImageUpload(opts: {
  projectId: string;
  reportId: string;
  replaceText: (placeholder: string, next: string) => void;
}) {
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const patch = (id: number, p: Partial<UploadStatus> | null) =>
    setUploads((prev) => (p === null ? prev.filter((u) => u.id !== id) : prev.map((u) => (u.id === id ? { ...u, ...p } : u))));

  /** Start uploading `files`; returns the placeholder text to insert now. */
  const start = useCallback((files: File[]): string => {
    const placeholders: string[] = [];
    for (const file of files) {
      const id = nextId++;
      const name = file.name || "image";
      const placeholder = `![Uploading ${name} (${id})…]()`;
      placeholders.push(placeholder);
      setUploads((prev) => [...prev, { id, name, progress: 0 }]);
      const { projectId, reportId } = optsRef.current;
      api
        .uploadReportAsset(projectId, reportId, file, (f) => patch(id, { progress: f }))
        .then((asset) => {
          optsRef.current.replaceText(placeholder, `![](${asset.ref})`);
          patch(id, null);
        })
        .catch((e: Error) => {
          optsRef.current.replaceText(placeholder, "");
          patch(id, { error: e.message, progress: 0 });
        });
    }
    return placeholders.join("\n");
  }, []);

  const dismiss = useCallback((id: number) => patch(id, null), []);

  return { uploads, start, dismiss };
}
