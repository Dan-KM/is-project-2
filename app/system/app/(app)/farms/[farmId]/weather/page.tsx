import { Suspense } from "react";
import { deleteWeatherAction } from "@/app/actions/readings";
import { ConfirmButton } from "@/components/form/confirm-button";
import { ManualWeatherForm } from "@/components/forms/reading-forms";
import { WeatherCardSkeleton, WeatherSection } from "@/components/weather/weather-card";
import { Badge, Card, EmptyState, PageHeader, PageLoading, SectionTitle } from "@/components/ui";
import { formatDateTime, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import { orNotFound, requirePageActor } from "@/lib/page";
import { toNairobiLocalInput } from "@/lib/time";
import { getFarm } from "@/lib/services/farms";
import { listWeather } from "@/lib/services/weather";

// Stored weather rows for a farm, plus manual entry as a fallback.
// The live Open-Meteo card is at the top; manual entry is the fallback.

export default function WeatherPage(props: PageProps<"/farms/[farmId]/weather">) {
  return (
    <Suspense fallback={<PageLoading label={t("common.loading")} />}>
      <Weather params={props.params} />
    </Suspense>
  );
}

async function Weather({ params }: { params: PageProps<"/farms/[farmId]/weather">["params"] }) {
  const { farmId } = await params;
  const actor = await requirePageActor();
  const farm = await orNotFound(getFarm(actor, farmId));
  const rows = await listWeather(actor, farmId, 30);
  return (
    <>
      <PageHeader title={t("weather.title")} back={{ href: `/farms/${farmId}`, label: farm.farmName }} />

      <div className="mb-5">
        <Suspense fallback={<WeatherCardSkeleton />}>
          <WeatherSection actor={actor} farmId={farmId} />
        </Suspense>
      </div>

      <SectionTitle>{t("weather.manual.title")}</SectionTitle>
      <Card className="mb-5">
        <p className="mb-3 text-sm text-muted">{t("weather.manual.hint")}</p>
        <ManualWeatherForm farmId={farmId} now={toNairobiLocalInput(new Date())} />
      </Card>

      {rows.length === 0 ? (
        <EmptyState>{t("weather.empty")}</EmptyState>
      ) : (
        <ul className="space-y-2">
          {rows.map((w) => (
            <li key={w.weatherId}>
              <Card>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium">{formatDateTime(w.dateTime)}</span>
                  <Badge tone="info">{t(`weather.type.${w.recordType}`)}</Badge>
                </div>
                <p className="text-sm text-muted">
                  {formatNumber(w.ambientTemperature)} °C · {formatNumber(w.relativeHumidity)} % ·{" "}
                  {t("label.rainfall24h")}: {formatNumber(w.rainfall24h)} · {t("label.rainfallForecast24h")}:{" "}
                  {formatNumber(w.rainfallForecast24h)} · ET₀ {formatNumber(w.evapotranspirationRate)}
                </p>
                <div className="mt-2">
                  <ConfirmButton action={deleteWeatherAction} payload={{ weatherId: w.weatherId }} label={t("common.delete")} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
