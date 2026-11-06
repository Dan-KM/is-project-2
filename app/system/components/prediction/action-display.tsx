import { CircleCheck, Droplet, Droplets, Waves, type LucideIcon } from "lucide-react";
import { Icon } from "@/components/icon";
import { Badge, cx } from "@/components/ui";
import type { IrrigationAction } from "@/lib/features/catalog";
import { t } from "@/lib/i18n";

// How each recommendation looks. Colour escalates with the amount of water,
// and every action also has its own icon and words, so colour is never the
// only signal (ui-ux-pro-max: color-not-only).

export const ACTION_STYLE: Record<IrrigationAction, { icon: LucideIcon; tone: "info" | "good" | "warn" | "bad"; panel: string }> = {
  No_Irrigation: { icon: CircleCheck, tone: "info", panel: "bg-info-soft text-info" },
  Low: { icon: Droplet, tone: "good", panel: "bg-success-soft text-primary" },
  Medium: { icon: Droplets, tone: "warn", panel: "bg-warning-soft text-warning" },
  High: { icon: Waves, tone: "bad", panel: "bg-danger-soft text-danger" },
};

export function isIrrigationAction(value: string): value is IrrigationAction {
  return value in ACTION_STYLE;
}

/** The big result panel. */
export function ActionPanel({ action }: { action: IrrigationAction }) {
  const style = ACTION_STYLE[action];
  return (
    <div className={cx("flex items-center gap-4 rounded-2xl p-5", style.panel)} role="status" aria-live="polite">
      <Icon icon={style.icon} size="xl" />
      <div>
        <p className="text-2xl font-semibold leading-tight">{t(`prediction.action.${action}`)}</p>
        <p className="mt-1">{t(`prediction.actionHint.${action}`)}</p>
      </div>
    </div>
  );
}

/** Compact version for lists. */
export function ActionBadge({ action }: { action: string }) {
  if (!isIrrigationAction(action)) return <Badge>{action}</Badge>;
  const style = ACTION_STYLE[action];
  return (
    <Badge tone={style.tone}>
      <Icon icon={style.icon} size="sm" />
      {t(`prediction.action.${action}`)}
    </Badge>
  );
}
