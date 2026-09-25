import { useId, useState, type ReactNode } from "react";
import { parseSectionOpen, sectionStorageKey, type SectionName } from "./logic";

interface Props {
  name: SectionName;
  children?: ReactNode;
  /** Open until the user closes it this session. */
  defaultOpen?: boolean;
}

function readOpen(name: SectionName, fallback: boolean): boolean {
  try {
    return parseSectionOpen(sessionStorage.getItem(sectionStorageKey(name)), fallback);
  } catch {
    return fallback;
  }
}

/**
 * A collapsible group of settings under an uppercase header. Open/closed is
 * kept per section name in sessionStorage, so "Axes" stays closed on every
 * card once closed.
 */
export default function SettingsSection({ name, children, defaultOpen = true }: Props) {
  const id = useId();
  const [open, setOpen] = useState(() => readOpen(name, defaultOpen));
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      sessionStorage.setItem(sectionStorageKey(name), next ? "1" : "0");
    } catch {
      // Storage unavailable: the state just doesn't outlive the panel.
    }
  };
  return (
    <section className="border-b border-border-subtle py-1 last:border-b-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center gap-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-fg-muted hover:text-fg touch:min-h-10"
      >
        <i
          aria-hidden="true"
          className={`fa-solid fa-chevron-down text-[9px] transition-transform ${open ? "" : "-rotate-90"}`}
        />
        {name}
      </button>
      <div id={id} hidden={!open} className="pb-1">
        {children}
      </div>
    </section>
  );
}
