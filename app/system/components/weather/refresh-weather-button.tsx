"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { refreshWeatherAction } from "@/app/actions/readings";
import { Icon } from "@/components/icon";
import { buttonStyles, cx } from "@/components/ui";
import { formatTimeOrDate } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Asks the server to fetch fresh weather now (skipping the cache). The page
 * re-renders with the new values, or with the last known values and an error
 * banner if the service is still down.
 */
export function RefreshWeatherButton({ farmId, retry = false }: { farmId: string; retry?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The page re-renders after a refresh, but if the service was down it still
  // shows the cached values, so the button itself says the refresh failed
  const [failedNotice, setFailedNotice] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await refreshWeatherAction({ farmId });
            setError(result.ok ? null : result.error);
            setFailedNotice(
              result.ok && result.data.fetchFailed
                ? result.data.observedAt
                  ? `${t("weatherCard.failed")} ${t("weatherCard.source.stored", { time: formatTimeOrDate(result.data.observedAt) })}.`
                  : t("weatherCard.failedNoData")
                : null,
            );
          })
        }
        className={cx(retry ? buttonStyles.primary : buttonStyles.secondary, "w-full")}
      >
        <Icon icon={RefreshCw} size="sm" className={pending ? "animate-spin motion-reduce:animate-none" : undefined} />
        {pending ? t("weatherCard.refreshing") : retry ? t("weatherCard.retry") : t("weatherCard.refresh")}
      </button>
      {failedNotice && (
        <p role="status" className="mt-2 flex gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
          <Icon icon={CloudOff} size="sm" className="mt-0.5" />
          {failedNotice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
