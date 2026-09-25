/**
 * The keyboard shortcut list, opened with ⌘/ (Ctrl+/) anywhere in a project.
 * Mounted once by `ProjectLayout`.
 */

import { useState } from "react";
import Dialog, { DialogBody } from "./ui/Dialog";
import { formatShortcut } from "../lib/shortcuts";
import { IS_MAC, useShortcut } from "../lib/use-shortcut";

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["mod+k"], label: "Search panels" },
  { keys: ["mod+z"], label: "Undo" },
  { keys: ["mod+shift+z"], label: "Redo" },
  { keys: ["arrowleft", "arrowright"], label: "Previous / next card (full screen)" },
  { keys: ["escape"], label: "Close dialog, popover or full screen" },
  { keys: ["mod+/"], label: "Show keyboard shortcuts" },
];

export default function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  useShortcut("mod+/", () => setOpen((v) => !v), { allowInInputs: true });
  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" size="md">
      <DialogBody>
        <table className="w-full text-sm">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.label} className="border-b border-border last:border-0">
                <td className="py-2 pr-4 text-fg">{s.label}</td>
                <td className="py-2 text-right">
                  {s.keys.map((k) => (
                    <kbd
                      key={k}
                      className="mono ml-1 inline-block rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-xs text-fg-muted"
                    >
                      {formatShortcut(k, IS_MAC)}
                    </kbd>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DialogBody>
    </Dialog>
  );
}
