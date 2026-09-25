import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  title?: string;
  /** Clickable (e.g. jump to the step): renders a button. */
  onClick?: () => void;
}

/** Plain small text in a card header's action area ("step 1,200", "3 / 8"). */
export default function HeaderLabel({ children, title, onClick }: Props) {
  const cls = "num inline-flex h-[22px] shrink-0 items-center px-1 text-xs text-fg-subtle touch:h-10";
  if (!onClick) {
    return (
      <span title={title} className={cls}>
        {children}
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} title={title} className={`${cls} rounded hover:bg-bg-hover hover:text-fg`}>
      {children}
    </button>
  );
}
