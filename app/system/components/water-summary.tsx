import { Badge } from "@/components/ui";
import { formatLitres } from "@/lib/format";
import { t } from "@/lib/i18n";

// Small shared pieces for the water screens (server-safe).

/** Tank = given to fields + not yet given, as a bar so the split reads at a glance. */
export function TankSummary({
  balance, allocated, unallocated,
}: { balance: number; allocated: number; unallocated: number }) {
  const allocatedPct = balance > 0 ? Math.round((allocated / balance) * 100) : 0;
  return (
    <div>
      <p className="text-sm text-muted">{t("water.balance")}</p>
      <p className="mb-3 text-3xl font-semibold tracking-tight">{formatLitres(balance)}</p>
      <div
        className="mb-2 flex h-3 overflow-hidden rounded-full bg-accent"
        role="img"
        aria-label={`${t("water.allocated")}: ${formatLitres(allocated)}, ${t("water.unallocated")}: ${formatLitres(unallocated)}`}
      >
        <div className="bg-primary" style={{ width: `${allocatedPct}%` }} />
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="flex items-center gap-1.5 text-muted">
            <span aria-hidden className="inline-block size-2.5 rounded-full bg-primary" /> {t("water.allocated")}
          </dt>
          <dd className="font-medium">{formatLitres(allocated)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-muted">
            <span aria-hidden className="inline-block size-2.5 rounded-full border border-border bg-accent" /> {t("water.unallocated")}
          </dt>
          <dd className="font-medium">{formatLitres(unallocated)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-sm text-muted">{t("water.unallocatedHint")}</p>
    </div>
  );
}

export function BudgetStatusBadge({ status }: { status: "NO_ALLOCATION" | "EXHAUSTED" | "AVAILABLE" }) {
  const tone = status === "AVAILABLE" ? "good" : status === "EXHAUSTED" ? "bad" : "neutral";
  return <Badge tone={tone}>{t(`water.budgetStatus.${status}`)}</Badge>;
}
