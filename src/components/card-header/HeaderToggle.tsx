import { ICON_BTN } from "./icon-btn";

interface Props {
  /** Font Awesome class, e.g. "fa-arrows-left-right". */
  icon: string;
  /** Accessible name and tooltip. */
  label: string;
  pressed: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

/** An on/off icon button in a card header (sync, log scale, interact). */
export default function HeaderToggle({ icon, label, pressed, onToggle, disabled }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      className={`${ICON_BTN} disabled:cursor-not-allowed disabled:opacity-40${pressed ? " bg-accent/15 !text-accent" : ""}`}
    >
      <i className={`fa-solid ${icon}`} aria-hidden="true" />
    </button>
  );
}
