import Link from "next/link";
import { Suspense } from "react";
import { deleteFieldAction } from "@/app/actions/farms";
import { deleteGrowthAction } from "@/app/actions/plantings";
import { deleteReadingAction } from "@/app/actions/readings";
import { ConfirmButton } from "@/components/form/confirm-button";
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
  const [planting, budgets, readings] = await Promise.all([
    getActivePlanting(actor, fieldId),
    listFieldBudgets(actor, field.farmId),
    listReadings(actor, fieldId, 10),
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
              <ButtonLink href={`/plantings/${planting.fieldCropId}/growth/new`}>{t("growth.add")}</ButtonLink>
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

      {/* ---- Soil readings ---- */}
      <SectionTitle action={<ButtonLink href={`/fields/${fieldId}/readings/new`} variant="secondary">+ {t("reading.add")}</ButtonLink>}>
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
        <Link href={`/farms/${field.farmId}`} className="text-primary">← {field.farm.farmName}</Link>
      </p>
    </>
  );
}
