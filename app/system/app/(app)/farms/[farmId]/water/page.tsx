import { Undo2 } from "lucide-react";
import { Icon } from "@/components/icon";
import { NoteSummary } from "@/components/note-summary";
import Link from "next/link";
import { Suspense } from "react";
import { undoLatestWaterEntryAction } from "@/app/actions/water";
import { ConfirmButton } from "@/components/form/confirm-button";
import { InitialWaterForm, LedgerNoteForm, RefillForm } from "@/components/forms/water-forms";
import { Badge, Card, EmptyState, PageHeader, PageLoading, SectionTitle } from "@/components/ui";
import { BudgetStatusBadge, TankSummary } from "@/components/water-summary";
import { formatDateTime, formatLitres, formatNumber, formatSignedLitres } from "@/lib/format";
import { t } from "@/lib/i18n";
import { orNotFound, requirePageActor } from "@/lib/page";
import { toNairobiLocalInput } from "@/lib/time";
import { getFarm, getFarmWaterStatus } from "@/lib/services/farms";
import { listFieldBudgets } from "@/lib/services/fields";
import { listLedgerWithFields } from "@/lib/services/water";

// The farm's shared water supply: what's in the tank, how it is split between
// fields, adding water, and the full ledger with "undo last entry".

export default function FarmWaterPage(props: PageProps<"/farms/[farmId]/water">) {
  return (
    <Suspense fallback={<PageLoading label={t("common.loading")} />}>
      <FarmWater params={props.params} />
    </Suspense>
  );
}

const typeTone = { INITIAL_ENTRY: "info", REFILL: "good", IRRIGATION: "warn" } as const;

async function FarmWater({ params }: { params: PageProps<"/farms/[farmId]/water">["params"] }) {
  const { farmId } = await params;
  const actor = await requirePageActor();
  const farm = await orNotFound(getFarm(actor, farmId));
  const [status, budgets, ledger] = await Promise.all([
    getFarmWaterStatus(actor, farmId),
    listFieldBudgets(actor, farmId),
    listLedgerWithFields(actor, farmId, 50),
  ]);
  const started = ledger.length > 0;
  const now = toNairobiLocalInput(new Date());

  return (
    <>
      <PageHeader title={t("water.farm.title")} back={{ href: `/farms/${farmId}`, label: farm.farmName }} />

      {!started ? (
        <Card className="mb-5">
          <h2 className="mb-1 text-lg font-semibold">{t("water.initial.title")}</h2>
          <p className="mb-4 text-muted">{t("water.initial.hint")}</p>
          <InitialWaterForm farmId={farmId} now={now} />
        </Card>
      ) : (
        <>
          <Card className="mb-5">
            <TankSummary balance={status.balanceLitres} allocated={status.allocatedLitres} unallocated={status.unallocatedLitres} />
          </Card>
          <SectionTitle>{t("water.refill.title")}</SectionTitle>
          <Card className="mb-5">
            <p className="mb-3 text-sm text-muted">{t("water.refill.hint")}</p>
            <RefillForm farmId={farmId} now={now} />
          </Card>
        </>
      )}

      {/* ---- Field budgets ---- */}
      <SectionTitle>{t("water.fieldsTitle")}</SectionTitle>
      {budgets.length === 0 ? (
        <div className="mb-5">
          <EmptyState>{t("field.empty")}</EmptyState>
        </div>
      ) : (
        <ul className="mb-5 space-y-2">
          {budgets.map((b) => (
            <li key={b.fieldId}>
              <Link href={`/fields/${b.fieldId}/water`} className="block">
                <Card className="transition-colors hover:border-primary">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{b.fieldName}</p>
                    <BudgetStatusBadge status={b.budgetStatus} />
                  </div>
                  <p className="text-sm text-muted">
                    {b.allocationPercentage === null
                      ? t("field.noAllocation")
                      : `${formatNumber(b.allocationPercentage)} % · ${formatLitres(b.remainingBudgetLitres)}`}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* ---- Ledger ---- */}
      <SectionTitle>{t("water.ledger.title")}</SectionTitle>
      {!started ? (
        <EmptyState>{t("water.ledger.empty")}</EmptyState>
      ) : (
        <>
          <div className="mb-3">
            <ConfirmButton
              action={undoLatestWaterEntryAction}
              payload={{ farmId }}
              label={t("water.undo")}
              icon={<Icon icon={Undo2} size="sm" />}
              confirmLabel={t("water.undoConfirm")}
              pendingLabel={t("water.undoing")}
              warning={t("water.undo.warning")}
              variant="secondary"
            />
          </div>
          <ul className="space-y-2">
            {ledger.map((entry) => (
              <li key={entry.transactionId}>
                <Card>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Badge tone={typeTone[entry.transactionType]}>{t(`water.type.${entry.transactionType}`)}</Badge>
                      <p className="mt-1 text-sm text-muted">{formatDateTime(entry.transactionDate)}</p>
                    </div>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatSignedLitres(entry.transactionType === "IRRIGATION" ? -entry.quantityLitres : entry.quantityLitres)}
                    </p>
                  </div>
                  {entry.fieldName && (
                    <p className="mt-1 text-sm">
                      {t("water.ledger.forField", {
                        field: entry.fieldName,
                        crop: entry.cropName ? t(`crop.${entry.cropName}`) : "",
                      })}
                    </p>
                  )}
                  <p className="mt-1 text-sm text-muted">
                    {t("water.ledger.balanceAfter", { litres: formatLitres(entry.balanceAfterLitres) })}
                  </p>
                  <details className="mt-2">
                    <summary className="min-h-11 cursor-pointer list-none py-2 [&::-webkit-details-marker]:hidden text-sm font-medium text-primary">
                      <NoteSummary notes={entry.notes} />
                    </summary>
                    <LedgerNoteForm transactionId={entry.transactionId} notes={entry.notes ?? ""} />
                  </details>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
