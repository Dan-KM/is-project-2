import { CloudSun, Droplets, Plus } from "lucide-react";
import { Icon } from "@/components/icon";
import { WeatherCardSkeleton, WeatherSection } from "@/components/weather/weather-card";
import Link from "next/link";
import { Suspense } from "react";
import { deleteFarmAction } from "@/app/actions/farms";
import { ConfirmButton } from "@/components/form/confirm-button";
import { Badge, ButtonLink, Card, DetailList, EmptyState, PageHeader, PageLoading, SectionTitle } from "@/components/ui";
import { formatLitres, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { orNotFound, requirePageActor } from "@/lib/page";
import { getFarm } from "@/lib/services/farms";
import { listFieldBudgets, listFieldsWithCrops } from "@/lib/services/fields";

export default function FarmPage(props: PageProps<"/farms/[farmId]">) {
  return (
    <Suspense fallback={<PageLoading label={t("common.loading")} />}>
      <FarmDetail params={props.params} />
    </Suspense>
  );
}

async function FarmDetail({ params }: { params: PageProps<"/farms/[farmId]">["params"] }) {
  const { farmId } = await params;
  const actor = await requirePageActor();
  const farm = await orNotFound(getFarm(actor, farmId));
  const [fields, budgets] = await Promise.all([listFieldsWithCrops(actor, farmId), listFieldBudgets(actor, farmId)]);
  const usedArea = fields.reduce((sum, f) => sum + Number(f.area), 0);

  return (
    <>
      <PageHeader
        title={farm.farmName}
        back={{ href: "/", label: t("nav.home") }}
        action={<ButtonLink href={`/farms/${farmId}/edit`} variant="secondary">{t("common.edit")}</ButtonLink>}
      />

      <Card className="mb-5">
        <DetailList
          items={[
            { label: t("label.farmAddress"), value: farm.farmAddress },
            { label: t("label.farmArea"), value: `${formatNumber(farm.area)} ha` },
            { label: t("label.latitude"), value: formatNumber(farm.latitude) },
            { label: t("label.longitude"), value: formatNumber(farm.longitude) },
          ]}
        />
        <p className="mt-3 text-sm text-muted">
          {t("farm.areaUsed", { used: formatNumber(usedArea), total: formatNumber(farm.area) })}
        </p>
      </Card>

      {/* Weather streams in on its own, so a slow weather service never delays the page */}
      <div className="mb-5">
        <Suspense fallback={<WeatherCardSkeleton />}>
          <WeatherSection actor={actor} farmId={farmId} />
        </Suspense>
      </div>

      <SectionTitle action={<ButtonLink href={`/farms/${farmId}/fields/new`} variant="secondary" icon={<Icon icon={Plus} size="sm" />}>{t("field.add")}</ButtonLink>}>
        {t("farm.fields")}
      </SectionTitle>
      {fields.length === 0 ? (
        <EmptyState>{t("field.empty")}</EmptyState>
      ) : (
        <ul className="mb-5 space-y-3">
          {fields.map((field) => {
            const budget = budgets.find((b) => b.fieldId === field.fieldId);
            return (
              <li key={field.fieldId}>
                <Link href={`/fields/${field.fieldId}`} className="block">
                  <Card className="transition-colors hover:border-primary">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-lg font-semibold">{field.fieldName}</p>
                      {field.activePlanting ? (
                        <Badge tone="good">{t(`crop.${field.activePlanting.crop.cropName}`)}</Badge>
                      ) : (
                        <Badge>{t("field.noCrop")}</Badge>
                      )}
                    </div>
                    <p className="text-muted">
                      {t(`soil.${field.soilType}`)} · {formatNumber(field.area)} ha
                    </p>
                    <p className="mt-1 text-sm">
                      {t("field.budget")}:{" "}
                      {budget?.budgetStatus === "NO_ALLOCATION" ? t("field.noAllocation") : formatLitres(budget?.remainingBudgetLitres)}
                    </p>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-5 space-y-3">
        <ButtonLink href={`/farms/${farmId}/water`} className="w-full" icon={<Icon icon={Droplets} />}>
          {t("water.farm.title")}
        </ButtonLink>
        <ButtonLink href={`/farms/${farmId}/weather`} variant="secondary" className="w-full" icon={<Icon icon={CloudSun} />}>
          {t("farm.weatherLink")}
        </ButtonLink>
        <ConfirmButton
          action={deleteFarmAction}
          payload={{ farmId }}
          label={`${t("common.delete")} ${farm.farmName}`}
          warning={t("farm.delete.warning")}
          redirectTo="/"
        />
      </div>
    </>
  );
}
