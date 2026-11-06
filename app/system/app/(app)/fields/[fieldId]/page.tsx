import { ChevronLeft, Droplets, Plus, Sparkles } from "lucide-react";
import { Icon } from "@/components/icon";
import Link from "next/link";
import { Suspense } from "react";
import { deleteFieldAction } from "@/app/actions/farms";
import { deleteGrowthAction } from "@/app/actions/plantings";
import { deleteReadingAction } from "@/app/actions/readings";
import { ConfirmButton } from "@/components/form/confirm-button";
import { ActionBadge } from "@/components/prediction/action-display";
import { estimatedCount } from "@/lib/features/stored";
import { listPredictions } from "@/lib/services/predictions";
import { Badge, ButtonLink, Card, DetailList, EmptyState, PageHeader, PageLoading, SectionTitle } from "@/components/ui";
import { formatDate, formatDateTime, formatLitres, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { orNotFound, requirePageActor } from "@/lib/page";
import { daysSinceDate } from "@/lib/time";
import { getField, listFieldBudgets } from "@/lib/services/fields";
import { getActivePlanting, listGrowthRecords } from "@/lib/services/plantings";
import { listReadings } from "@/lib/services/readings";

export default function FieldPage(props: PageProps<"/fields/[fieldId]">) {
  return (
    <Suspense fallback={<PageLoading label={t("common.loading")} />}>
      <FieldDetail params={props.params} />
    </Suspense>
  );
}

async function FieldDetail({ params }: { params: PageProps<"/fields/[fieldId]">["params"] }) {
  const { fieldId } = await params;
  const actor = await requirePageActor();
  const field = await orNotFound(getField(actor, fieldId));
  const [planting, budgets, readings, predictions] = await Promise.all([
    getActivePlanting(actor, fieldId),
    listFieldBudgets(actor, field.farmId),
    listReadings(actor, fieldId, 10),
    listPredictions(actor, fieldId, 5),
  ]);
  const growth = planting ? await listGrowthRecords(actor, planting.fieldCropId) : [];
  const budget = budgets.find((b) => b.fieldId === fieldId);

  return (
    <>
      <PageHeader
        title={field.fieldName}
        back={{ href: `/farms/${field.farmId}`, label: field.farm.farmName }}
        action={<ButtonLink href={`/fields/${fieldId}/edit`} variant="secondary">{t("common.edit")}</ButtonLink>}
      />

      <Card className="mb-5">
        <DetailList
          items={[
            { label: t("label.soilType"), value: t(`soil.${field.soilType}`) },
            { label: t("label.fieldArea"), value: `${formatNumber(field.area)} ha` },
            { label: t("label.fieldSlope"), value: field.fieldSlope === null ? "—" : `${formatNumber(field.fieldSlope)} %` },
            {
              label: t("field.budget"),
              value: budget?.budgetStatus === "NO_ALLOCATION" ? t("field.noAllocation") : formatLitres(budget?.remainingBudgetLitres),
            },
          ]}
        />
        {/* The main thing a farmer comes here for: one primary action per screen */}
        <ButtonLink href={`/fields/${fieldId}/predict`} className="mt-4 w-full" icon={<Icon icon={Sparkles} />}>
          {t("predict.cta")}
        </ButtonLink>
        <ButtonLink href={`/fields/${fieldId}/water`} variant="secondary" className="mt-2 w-full" icon={<Icon icon={Droplets} />}>
          {t("water.manageField")}
        </ButtonLink>
      </Card>

      {/* ---- Crop ---- */}
      <SectionTitle>{t("planting.title")}</SectionTitle>
      <Card className="mb-5">
        {planting ? (
          <>
            <div className="flex items-start justify-between gap-2">
              <p className="text-xl font-semibold">{t(`crop.${planting.crop.cropName}`)}</p>
              <Badge tone="good">{t("planting.active")}</Badge>
            </div>
            <p className="text-muted">
              {t("planting.since", { date: formatDate(planting.plantingDate), days: daysSinceDate(planting.plantingDate) })}
            </p>
            <p className="mt-2">
              {t("growth.current")}:{" "}
              <strong>{growth[0] ? t(`stage.${growth[0].growthStage}`) : "—"}</strong>
            </p>
            <div className="mt-3 grid gap-2">
              <ButtonLink href={`/plantings/${planting.fieldCropId}/growth/new`} variant="secondary">{t("growth.add")}</ButtonLink>
            </div>
          </>
        ) : (
          <p className="mb-3 text-muted">{t("field.noCrop")}</p>
        )}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <ButtonLink href={`/fields/${fieldId}/plant`} variant="secondary">
            {planting ? t("planting.replace") : t("planting.plant")}
          </ButtonLink>
          <ButtonLink href={`/fields/${fieldId}/plantings`} variant="secondary">
            {t("planting.history")}
          </ButtonLink>
        </div>
      </Card>

      {/* ---- Growth records of the current crop ---- */}
      {planting && (
        <>
          <SectionTitle>{t("growth.title")}</SectionTitle>
          {growth.length === 0 ? (
            <div className="mb-5">
              <EmptyState>{t("growth.empty")}</EmptyState>
            </div>
          ) : (
            <ul className="mb-5 space-y-2">
              {growth.map((g) => (
                <li key={g.evolutionId}>
                  <Card>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold">{t(`stage.${g.growthStage}`)}</p>
                      <span className="text-sm text-muted">{formatDateTime(g.recordedAt)}</span>
                    </div>
                    <p className="text-sm text-muted">
                      {t("label.daysSincePlanting")}: {g.daysSincePlanting ?? "—"} · {t("label.rootZoneDepth")}:{" "}
                      {formatNumber(g.rootZoneDepth)} · {t("label.leafAreaIndex")}: {formatNumber(g.leafAreaIndex)}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <ButtonLink href={`/growth/${g.evolutionId}/edit`} variant="secondary">{t("common.edit")}</ButtonLink>
                      <ConfirmButton action={deleteGrowthAction} payload={{ evolutionId: g.evolutionId }} label={t("common.delete")} />
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ---- Recommendations (stored predictions) ---- */}
      <SectionTitle>{t("predict.history.title")}</SectionTitle>
      {predictions.length === 0 ? (
        <div className="mb-5">
          <EmptyState>{t("predict.history.empty")}</EmptyState>
        </div>
      ) : (
        <ul className="mb-5 space-y-2">
          {predictions.map((p) => {
            const estimated = estimatedCount(p);
            return (
              <li key={p.predictionId}>
                <Link href={`/predictions/${p.predictionId}`} className="block">
                  <Card className="transition-colors hover:border-primary">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <ActionBadge action={p.predictedIrrigationAction} />
                      <span className="text-sm text-muted">{formatDateTime(p.predictedAt)}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {t("feature.Soil_Moisture")}: {p.soilMoisture === null ? "—" : `${formatNumber(p.soilMoisture)} %`}
                      {estimated > 0 && ` · ${t("predict.history.estimated", { count: estimated })}`}
                      {p.modelVersion === "mock-v1" && ` · ${t("prediction.mockBadge")}`}
                    </p>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* ---- Soil readings ---- */}
      <SectionTitle action={<ButtonLink href={`/fields/${fieldId}/readings/new`} variant="secondary" icon={<Icon icon={Plus} size="sm" />}>{t("reading.add")}</ButtonLink>}>
        {t("reading.title")}
      </SectionTitle>
      {readings.length === 0 ? (
        <EmptyState>{t("reading.empty")}</EmptyState>
      ) : (
        <ul className="space-y-2">
          {readings.map((r) => (
            <li key={r.fieldConditionsId}>
              <Card>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-lg font-semibold">
                    {r.soilMoisture === null ? "—" : `${formatNumber(r.soilMoisture)} %`}
                  </p>
                  <span className="text-sm text-muted">{formatDateTime(r.dateTime)}</span>
                </div>
                <p className="text-sm text-muted">
                  pH {formatNumber(r.soilPh)} · EC {formatNumber(r.soilEc)} · {formatNumber(r.soilTemperature)} °C ·{" "}
                  {t("field.budget")} {formatLitres(r.waterAvailability)}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <ButtonLink href={`/readings/${r.fieldConditionsId}/edit`} variant="secondary">{t("common.edit")}</ButtonLink>
                  <ConfirmButton
                    action={deleteReadingAction}
                    payload={{ fieldConditionsId: r.fieldConditionsId }}
                    label={t("common.delete")}
                  />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        <ConfirmButton
          action={deleteFieldAction}
          payload={{ fieldId }}
          label={`${t("common.delete")} ${field.fieldName}`}
          warning={t("field.delete.warning")}
          redirectTo={`/farms/${field.farmId}`}
        />
      </div>
      <p className="mt-4 text-center text-sm">
        <Link href={`/farms/${field.farmId}`} className="inline-flex min-h-11 items-center gap-1 text-primary">
          <Icon icon={ChevronLeft} size="sm" /> {field.farm.farmName}
        </Link>
      </p>
    </>
  );
}
