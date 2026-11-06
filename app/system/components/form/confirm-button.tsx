"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/actions/run";
import { t } from "@/lib/i18n";
import { Icon } from "@/components/icon";
import { buttonStyles, cx } from "@/components/ui";

// A button for destructive or one-shot actions (delete, end planting, undo).
// First tap arms it ("Tap again to delete"), second tap runs it, so a stray
// tap on a phone can't delete anything. It disarms itself after 4 seconds.

type Props<P, T> = {
  action: (payload: P) => Promise<ActionResult<T>>;
  payload: P;
  label: string;
  confirmLabel?: string;
  pendingLabel?: string;
  warning?: string;
  /** Where to go afterwards; without it the current page refreshes. */
  redirectTo?: string;
  variant?: keyof typeof buttonStyles;
  className?: string;
  /** Optional leading icon (an <Icon />), shown in the idle state. */
  icon?: ReactNode;
};

export function ConfirmButton<P, T>({
  action, payload, label, confirmLabel = t("common.confirmDelete"), pendingLabel = t("common.deleting"),
  warning, redirectTo, variant = "danger", className, icon,
}: Props<P, T>) {
  const router = useRouter();
  // Delete-style buttons get a trash icon unless the caller chose another
  const leadingIcon = icon ?? (variant === "danger" ? <Icon icon={Trash2} size="sm" /> : null);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  function onClick() {
    if (!armed) {
      setArmed(true);
      setError(null);
      return;
    }
    startTransition(async () => {
      const result = await action(payload);
      setArmed(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  return (
    <div className={className}>
      {armed && warning && <p className="mb-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">{warning}</p>}
      <button
        type="button"
        aria-live="polite"
        onClick={onClick}
        disabled={pending}
        className={cx(armed ? buttonStyles.dangerSolid : buttonStyles[variant], "w-full")}
      >
        {!pending && !armed && leadingIcon}
        {pending ? pendingLabel : armed ? confirmLabel : label}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
