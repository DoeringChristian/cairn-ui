import { useEffect, useMemo, useRef, useState } from "react";
import Popover from "./ui/Popover";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onCommit: (tag: string) => void;
  onCancel: () => void;
  suggestions: string[];
  exclude?: string[];
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}

const MAX_SUGGESTIONS = 8;

export default function TagInput({
  value,
  onChange,
  onCommit,
  onCancel,
  suggestions,
  exclude,
  placeholder = "tag",
  className = "",
  autoFocus = false,
  disabled = false,
}: Props) {
  const [activeIdx, setActiveIdx] = useState(-1);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const lower = value.trim().toLowerCase();
    const excSet = new Set(exclude ?? []);
    return suggestions
      .filter((s) => !excSet.has(s) && (lower === "" || s.toLowerCase().includes(lower)))
      .slice(0, MAX_SUGGESTIONS);
  }, [value, suggestions, exclude]);

  // Only show dropdown when there's input text and matching suggestions
  const showDropdown = open && value.trim() !== "" && filtered.length > 0;

  useEffect(() => {
    setActiveIdx(-1);
  }, [value]);

  const commit = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed) onCommit(trimmed);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" && showDropdown) {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp" && showDropdown) {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0 && activeIdx < filtered.length) {
        commit(filtered[activeIdx]!);
      } else {
        commit(value);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        className={`input py-0.5 text-xs touch:min-h-10 ${className}`}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          // Focus moving elsewhere by keyboard closes the list. Presses on the
          // list keep focus in the input (mousedown is prevented below), and
          // presses anywhere else close it through the popover.
          const next = e.relatedTarget;
          if (next instanceof Node && !listRef.current?.contains(next)) setOpen(false);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
      />
      <Popover
        open={showDropdown}
        onClose={() => setOpen(false)}
        anchorRef={inputRef}
        width="anchor"
        minWidth={160}
        align="start"
        compact="anchored"
        initialFocus={false}
        role="listbox"
        title="Tag suggestions"
      >
        <ul ref={listRef}>
          {filtered.map((tag, i) => (
            <li key={tag}>
              <button
                type="button"
                className={`block w-full px-2 py-1 text-left text-xs mono touch:min-h-10 ${
                  i === activeIdx
                    ? "bg-accent/10 text-fg"
                    : "text-fg-muted hover:bg-bg-hover"
                }`}
                // Keep focus in the input; the tap/click itself picks the tag.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(tag)}
                onMouseEnter={() => setActiveIdx(i)}
              >
                {tag}
              </button>
            </li>
          ))}
        </ul>
      </Popover>
    </>
  );
}
