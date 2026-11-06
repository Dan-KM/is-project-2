import { Droplets } from "lucide-react";
import { Icon } from "@/components/icon";
import { cx } from "@/components/ui";

/** The app's mark: a water-drop icon on the primary colour (replaces the old emoji). */
export function BrandMark({ large = false }: { large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex items-center justify-center rounded-xl bg-primary text-primary-foreground",
        large ? "size-14" : "size-8",
      )}
    >
      <Icon icon={Droplets} size={large ? "lg" : "sm"} />
    </span>
  );
}
