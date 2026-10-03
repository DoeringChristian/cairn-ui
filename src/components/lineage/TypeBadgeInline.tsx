import { typeBadgeStyle } from "../../lib/artifacts/type-style";

export function TypeBadgeInline({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium" style={typeBadgeStyle(type)}>
      {type}
    </span>
  );
}
