import type { LucideIcon } from "lucide-react";

// One icon family (Lucide, outline style) used everywhere, with a fixed size
// scale and a single stroke width so icons look consistent (ui-ux-pro-max:
// "icon-style-consistent", "consistent icon sizing"). Icons here are
// decorative: they always sit beside visible text, so they are hidden from
// screen readers. An icon-only control must add its own aria-label.

export const ICON_SIZES = { sm: 16, md: 20, lg: 24, xl: 40 } as const;

export function Icon({
  icon: Glyph, size = "md", className,
}: { icon: LucideIcon; size?: keyof typeof ICON_SIZES; className?: string }) {
  return (
    <Glyph
      aria-hidden="true"
      focusable="false"
      size={ICON_SIZES[size]}
      strokeWidth={2}
      className={["shrink-0", className].filter(Boolean).join(" ")}
    />
  );
}
