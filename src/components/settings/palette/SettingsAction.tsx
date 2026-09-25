import type { ReactNode } from "react";

interface Props {
  label: ReactNode;
  onClick: () => void;
  /** Font Awesome class, e.g. "fa-rotate-left". */
  icon?: string;
  description?: ReactNode;
  tone?: "default" | "danger";
  disabled?: boolean;
}

/** A one-shot action inside a settings panel ("Reset all", "Edit expressions…"). */
export default function SettingsAction({ label, onClick, icon, description, tone = "default", disabled }: Props) {
  return (
    <div className="py-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={[
          "inline-flex items-center gap-2 rounded border border-border bg-bg-elevated px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 touch:min-h-10 touch:px-3",
          tone === "danger"
            ? "text-status-failed hover:border-status-failed hover:bg-status-failed/10"
            : "text-fg hover:border-accent hover:bg-bg-hover",
        ].join(" ")}
      >
        {icon && <i className={`fa-solid ${icon}`} aria-hidden="true" />}
        {label}
      </button>
      {description && <p className="mt-1 text-xs text-fg-muted">{description}</p>}
    </div>
  );
}
