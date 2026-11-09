import { ArrowRight, Droplets } from "lucide-react";
import { Icon } from "@/components/icon";
import { NoteSummary } from "@/components/note-summary";
import { Suspense } from "react";
import { setAllocationAction } from "@/app/actions/water";
import { ConfirmButton } from "@/components/form/confirm-button";
import { AllocationForm, IrrigationForm, IrrigationNoteForm, TopUpForm } from "@/components/forms/water-forms";
import { Badge, ButtonLink, Card, DetailList, EmptyState, PageHeader, PageLoading, SectionTitle } from "@/components/ui";
import { BudgetStatusBadge } from "@/components/water-summary";
import { formatDateTime, formatLitres, formatNumber, formatSignedLitres, inputNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { orNotFound, requirePageActor } from "@/lib/page";
import { toNairobiLocalInput } from "@/lib/time";
import { getFarmWaterStatus } from "@/lib/services/farms";
import { getField, listFieldBudgets } from "@/lib/services/fields";
import { getActivePlanting } from "@/lib/services/plantings";
import { listAllocations, listBudgetHistory, listIrrigationEvents } from "@/lib/services/water";

// One field's water: its budget and allocation, recording irrigation, and the
// histories (irrigations, allocation changes, every budget change).

export default function FieldWaterPage(props: PageProps<"/fields/[fieldId]/water">) {
  return (
    <Suspense fallback={<PageLoading label={t("common.loading")} />}>
      <FieldWater params={props.params} />
    </Suspense>
  );
}

const reasonTone = { ALLOCATE: "good", IRRIGATE: "warn", RELEASE: "neutral" } as const;

// An ALLOCATE without a percentage was moved by hand from the farm reserve:
// on its own it is a top-up, linked to a ledger row it covered an irrigation.
function reasonLabel(h: { reason: string; allocationPercentage: unknown; waterTransactionId: string | null }) {
  if (h.reason !== "ALLOCATE" || h.allocationPercentage !== null) return h.reason;
  return h.waterTransactionId ? "BORROW" : "TOP_UP";
}

async function FieldWater({ params }: { params: PageProps<"/fields/[fieldId]/water">["params"] }) {
  const { fieldId } = await params;
  const actor = await requirePageActor();
  const field = await orNotFound(getField(actor, fieldId));
  const [budgets, farmWater, planting, allocations, events, history] = await Promise.all([
    listFieldBudgets(actor, field.farmId),
    getFarmWaterStatus(actor, field.farmId),
    getActivePlanting(actor, fieldId),
    listAllocations(actor, fieldId),
    listIrrigationEvents(actor, fieldId, 30),
    listBudgetHistory(actor, fieldId, 30),
  ]);
  const budget = budgets.find((b) => b.fieldId === fieldId);
  const status = budget?.budgetStatus ?? "NO_ALLOCATION";
  const now = toNairobiLocalInput(new Date());

  return (
    <>
      <PageHeader
        title={t("water.field.title", { field: field.fieldName })}
        back={{ href: `/fields/${fieldId}`, label: field.fieldName }}
      />

      <Card className="mb-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm text-muted">{t("water.field.budget")}</p>
          <BudgetStatusBadge status={status} />
        </div>
        <p className="mb-3 text-3xl font-semibold tracking-tight tabular-nums">
          {status === "NO_ALLOCATION" ? "—" : formatLitres(budget?.remainingBudgetLitres)}
        </p>
        <DetailList
          items={[
            {
              label: t("water.field.share"),
              value: budget?.allocationPercentage === null || !budget ? t("field.noAllocation") : `${formatNumber(budget.allocationPercentage)} %`,
            },
            { label: t("planting.title"), value: planting ? t(`crop.${planting.crop.cropName}`) : t("field.noCrop") },
          ]}
        />
        <ButtonLink href={`/farms/${field.farmId}/water`} variant="ghost" className="mt-2 -ml-2" icon={<Icon icon={Droplets} size="sm" />}>
          {t("water.farm.title")}
          <Icon icon={ArrowRight} size="sm" />
        </ButtonLink>
      </Card>

      {/* ---- Irrigation ---- */}
      <SectionTitle>{t("water.irrigate.title")}</SectionTitle>
      <Card className="mb-5">
        {!planting ? (
          <div>
            <p className="mb-3 text-muted">{t("water.irrigate.noPlanting")}</p>
            <ButtonLink href={`/fields/${fieldId}/plant`} variant="secondary" className="w-full">{t("planting.plant")}</ButtonLink>
          </div>
        ) : status === "NO_ALLOCATION" ? (
          <p className="text-muted">{t("water.irrigate.noAllocation")}</p>
        ) : (
          <IrrigationForm fieldCropId={planting.fieldCropId} now={now} />
        )}
      </Card>

      {/* ---- Top up from the farm reserve ---- */}
      {status !== "NO_ALLOCATION" && (
        <>
          <SectionTitle>{t("water.topUp.title")}</SectionTitle>
          <Card className="mb-5">
            <TopUpForm fieldId={fieldId} reserveLitres={farmWater.unallocatedLitres} />
          </Card>
        </>
      )}

      {/* ---- Allocation ---- */}
      <SectionTitle>{t("water.allocation.title")}</SectionTitle>
      <Card className="mb-5">
        <AllocationForm fieldId={fieldId} percentage={inputNumber(budget?.allocationPercentage)} />
        {status !== "NO_ALLOCATION" && (
          <div className="mt-3">
            <ConfirmButton
              action={setAllocationAction}
              payload={{ fieldId }}
              label={t("water.allocation.remove")}
              confirmLabel={t("water.allocation.removeConfirm")}
              pendingLabel={t("common.saving")}
              warning={t("water.allocation.removeWarning")}
            />
          </div>
        )}
      </Card>

      {/* ---- Irrigation history ---- */}
      <SectionTitle>{t("water.irrigations.title")}</SectionTitle>
      {events.length === 0 ? (
        <div className="mb-5">
          <EmptyState>{t("water.irrigations.empty")}</EmptyState>
        </div>
      ) : (
        <ul className="mb-5 space-y-2">
          {events.map((e) => (
            <li key={e.eventId}>
              <Card>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-lg font-semibold tabular-nums">{formatLitres(e.quantityUsedLitres)}</p>
                  <span className="text-sm text-muted">{formatDateTime(e.irrigationDate)}</span>
                </div>
                <details className="mt-1">
                  <summary className="min-h-11 cursor-pointer list-none py-2 [&::-webkit-details-marker]:hidden text-sm font-medium text-primary">
                    <NoteSummary notes={e.notes} />
                  </summary>
                  <IrrigationNoteForm eventId={e.eventId} notes={e.notes ?? ""} />
                </details>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* ---- Allocation history ---- */}
      {allocations.length > 0 && (
        <>
          <SectionTitle>{t("water.allocation.history")}</SectionTitle>
          <Card className="mb-5">
            <ul className="divide-y divide-border">
              {allocations.map((a) => (
                <li key={a.allocationId} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-sm text-muted">
                    {t("water.allocation.period", {
                      from: formatDateTime(a.effectiveFrom),
                      until: a.effectiveUntil ? formatDateTime(a.effectiveUntil) : t("water.allocation.now"),
                    })}
                  </span>
                  <span className="font-semibold">{formatNumber(a.allocationPercentage)} %</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {/* ---- Budget history (field_budget_transaction audit trail) ---- */}
      <SectionTitle>{t("water.budgetHistory.title")}</SectionTitle>
      {history.length === 0 ? (
        <EmptyState>{t("water.budgetHistory.empty")}</EmptyState>
      ) : (
        <ul className="space-y-2">
          {history.map((h) => (
            <li key={h.budgetTxnId}>
              <Card>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Badge tone={reasonTone[h.reason as keyof typeof reasonTone] ?? "neutral"}>{t(`water.reason.${reasonLabel(h)}`)}</Badge>
                    <p className="mt-1 text-sm text-muted">{formatDateTime(h.createdAt)}</p>
                  </div>
                  <p className="font-semibold tabular-nums">{formatSignedLitres(h.changeLitres)}</p>
                </div>
                {h.reason === "ALLOCATE" && h.allocationPercentage !== null && (
                  <p className="mt-1 text-sm">
                    {t("water.reason.allocateDetail", {
                      pct: formatNumber(h.allocationPercentage),
                      pool: formatLitres(h.unallocatedBeforeLitres),
                    })}
                  </p>
                )}
                {reasonLabel(h) !== h.reason && (
                  <p className="mt-1 text-sm">
                    {t("water.reason.topUpDetail", { pool: formatLitres(h.unallocatedBeforeLitres) })}
                  </p>
                )}
                {h.budgetAfterLitres !== null && (
                  <p className="text-sm text-muted">{t("water.budgetAfter", { litres: formatLitres(h.budgetAfterLitres) })}</p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
