import "./select.css";
// Portal placement and interaction model adapted from Cairn's ui/Popover.tsx.
import { useEffect, useLayoutEffect, useRef, useState, useId } from "react";
import { createPortal } from "react-dom";
import { computePlacement } from "./placement";
import { Check, ChevronDown } from "lucide-react";
export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};
export function Select({
  value,
  onChange,
  options,
  label,
  disabled = false,
  buttonId,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label: string;
  disabled?: boolean;
  buttonId?: string;
}) {
  const anchor = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const id = useId();
  const close = () => {
    setOpen(false);
    anchor.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!open || !panel.current || !anchor.current) return;
    const place = () => {
      const box = anchor.current!.getBoundingClientRect(),
        el = panel.current!;
      const p = computePlacement({
        anchor: box,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        width: Math.max(220, box.width),
        naturalHeight: Math.min(options.length * 42 + 14, 340),
        align: "end",
      });
      Object.assign(el.style, {
        left: `${p.left}px`,
        top: `${p.top}px`,
        width: `${p.width}px`,
        maxHeight: `${p.maxHeight}px`,
      });
    };
    place();
    panel.current.focus();
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    return () => {
      removeEventListener("resize", place);
      removeEventListener("scroll", place, true);
    };
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !anchor.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    addEventListener("pointerdown", outside);
    return () => removeEventListener("pointerdown", outside);
  }, [open]);
  function choose(index: number) {
    const option = options[index];
    if (option && !option.disabled) {
      onChange(option.value);
      close();
    }
  }
  function show() {
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    setOpen(true);
  }
  return (
    <>
      <button
        type="button"
        id={buttonId}
        ref={anchor}
        className="custom-select"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
            e.preventDefault();
            show();
          }
        }}
      >
        <span>{options.find((o) => o.value === value)?.label || label}</span>
        <ChevronDown aria-hidden="true" size={13} />
      </button>
      {open &&
        createPortal(
          <div
            id={id}
            ref={panel}
            className="select-popover"
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            aria-activedescendant={`${id}-${active}`}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                close();
              } else if (e.key === "Tab") setOpen(false);
              else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setActive(
                  (a) =>
                    (a + (e.key === "ArrowDown" ? 1 : -1) + options.length) %
                    options.length,
                );
              } else if (e.key === "Home") {
                e.preventDefault();
                setActive(0);
              } else if (e.key === "End") {
                e.preventDefault();
                setActive(options.length - 1);
              } else if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                choose(active);
              } else if (e.key.length === 1) {
                const index = options.findIndex((o) =>
                  o.label.toLowerCase().startsWith(e.key.toLowerCase()),
                );
                if (index >= 0) setActive(index);
              }
            }}
          >
            {options.map((option, index) => (
              <div
                id={`${id}-${index}`}
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                className={`select-option ${index === active ? "focused" : ""}`}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(index)}
              >
                <span>
                  {option.label}
                  {option.description && <small>{option.description}</small>}
                </span>
                {option.value === value && (
                  <Check aria-hidden="true" size={13} />
                )}
              </div>
            ))}
          </div>,
          document.fullscreenElement?.contains(anchor.current)
            ? document.fullscreenElement
            : anchor.current?.closest("dialog") || document.body,
        )}
    </>
  );
}
