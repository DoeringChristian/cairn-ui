import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** `accent`: an active mode; `warn`: something needs attention (e.g. an as-of join). */
  tone?: "muted" | "accent" | "warn";
  title?: string;
}

const TONES = {
  muted: "border-border text-fg-subtle",
  accent: "border-accent/40 bg-accent/10 text-accent",
  warn: "border-status-running/40 bg-status-running/10 text-status-running",
} as const;

/** A small status pill in a card header ("log", "EMA 0.6", "3 hidden"). */
export default function HeaderBadge({ children, tone = "muted", title }: Props) {
  return (
    <span
      title={title}
      className={`mono inline-flex h-[18px] shrink-0 items-center rounded border px-1.5 text-[10px] leading-none ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
