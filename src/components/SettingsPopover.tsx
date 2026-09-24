import type { RefObject, ReactNode } from "react";
import Popover from "./ui/Popover";

interface Props {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  /** Optional title displayed at the top of the popover. */
  title?: string;
}

/**
 * A 320px settings panel right-aligned under its anchor (a bottom sheet on
 * phones) — `Popover` with the settings panel's padding and heading.
 */
export default function SettingsPopover({ open, onClose, anchorRef, children, title }: Props) {
  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      title={title ?? "Settings"}
      titleAnchored={title != null}
      width={320}
      align="end"
      bodyClassName="p-4"
    >
      {children}
    </Popover>
  );
}
